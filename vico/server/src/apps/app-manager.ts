/**
 * 轻应用管理器 — 扫描应用目录、维护安装状态、注入后端路由、托管前端静态资源。
 *
 * 应用清单来自文件系统（默认 `~/vico/apps`），安装状态落库 `light_apps` 表。
 * 后端路由采用「稳定分发 + 懒加载子 app」：vico 只注册一次
 * `/api/apps/<id>/*` 分发入口，请求到达时再按安装/启用状态查找子 app，
 * 因此安装、禁用、卸载无需改动 Hono 路由表即可即时生效。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '../db/db.js';
import { light_apps } from '../db/schema.js';
import type { Logger } from 'pino';
import type { AppsConfig } from '../config/schemas.js';
import type {
  AppServerContext,
  AppServerSetup,
  LightAppManifest,
  LightAppSummary,
} from './types.js';

/** 清单校验 schema —— 缺省字段在解析阶段补齐，避免各调用点重复兜底 */
const manifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'id 只能包含小写字母、数字、点、下划线和中划线，且不能以符号开头'),
  name: z.string().min(1).max(64),
  version: z.string().default('0.0.0'),
  description: z.string().default(''),
  icon: z.string().default('🧩'),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  frontend: z
    .object({
      dist: z.string().default('dist'),
      entry: z.string().default('index.html'),
    })
    .default({ dist: 'dist', entry: 'index.html' }),
  server: z
    .object({
      entry: z.string().optional(),
    })
    .optional(),
  dev: z
    .object({
      url: z.string().optional(),
    })
    .optional(),
});

/** 后端入口候选顺序：优先清单声明，否则按常见文件名探测 */
const DEFAULT_SERVER_ENTRIES = ['server/index.ts', 'server/index.mjs', 'server/index.js'];

/** 静态资源 MIME 映射（覆盖前端构建产物常见类型） */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

/** 单个应用的后端运行时缓存（按入口文件 mtime 失效，支持改代码后重新加载） */
interface RuntimeEntry {
  entry: string;
  mtimeMs: number;
  subApp: Hono;
}

/**
 * 展开 `~` 前缀并按需解析为绝对路径。
 * @param p 配置中的路径
 * @returns 绝对路径
 */
/** 相对路径解析基准：server 包根目录（与运行时 cwd 无关） */
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 展开 `~` 前缀并按需解析为绝对路径。
 * 相对路径以 server 包根目录为基准，避免受启动 cwd 影响。
 * @param p 配置中的路径
 * @returns 绝对路径
 */
function expandPath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(SERVER_ROOT, p);
}

/** 应用内部错误 — 携带对用户可读的提示信息 */
export class AppLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppLoadError';
  }
}

/**
 * 轻应用管理器（模块级单例，首次访问时按容器配置构建）。
 */
export class AppManager {
  constructor(
    private readonly db: AppDb,
    private readonly config: AppsConfig,
    private readonly logger: Logger,
  ) {}

  /** 后端运行时缓存：appId → 已加载的子 app */
  private readonly runtimes = new Map<string, RuntimeEntry>();

  /**
   * 扫描全部配置目录，返回应用摘要列表（已合并安装状态）。
   *
   * 每次调用都重新读取文件系统，方便开发时新增/修改应用后刷新即可看到。
   *
   * @returns 应用摘要列表，已安装的排在最前
   */
  async list(): Promise<LightAppSummary[]> {
    const manifests = this.scan();
    const states = await this.readStates();
    const apps = manifests.map((item) => this.toSummary(item, states.get(item.manifest.id)));
    return apps.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  /**
   * 按 id 获取应用摘要。
   * @param id 应用 id
   * @returns 应用摘要，不存在时 undefined
   */
  async get(id: string): Promise<LightAppSummary | undefined> {
    const manifest = this.findManifest(id);
    if (!manifest) return undefined;
    return this.toSummary(manifest, (await this.readStates()).get(id));
  }

  /**
   * 安装应用（幂等）：写入安装记录并默认启用。
   * @param id 应用 id
   * @returns 安装后的应用摘要
   * @throws AppLoadError 应用不存在或清单无效
   */
  async install(id: string): Promise<LightAppSummary> {
    const manifest = this.requireManifest(id);
    const now = Date.now();
    await this.db
      .insert(light_apps)
      .values({ id, installed: 1, enabled: 1, installed_at: now, updated_at: now })
      .onConflictDoUpdate({
        target: light_apps.id,
        set: { installed: 1, enabled: 1, updated_at: now },
      })
      .run();
    this.runtimes.delete(id);
    this.logger.info({ appId: id }, 'Light app installed');
    return this.toSummary(manifest, { installed: true, enabled: true });
  }

  /**
   * 卸载应用：删除安装记录，同时停止后端分发与静态访问。
   * @param id 应用 id
   */
  async uninstall(id: string): Promise<void> {
    await this.db.delete(light_apps).where(eq(light_apps.id, id)).run();
    this.runtimes.delete(id);
    this.logger.info({ appId: id }, 'Light app uninstalled');
  }

  /**
   * 启用/禁用已安装应用。
   * @param id 应用 id
   * @param enabled true 启用，false 禁用
   * @returns 更新后的应用摘要
   */
  async setEnabled(id: string, enabled: boolean): Promise<LightAppSummary> {
    const manifest = this.requireManifest(id);
    const state = (await this.readStates()).get(id);
    if (!state?.installed) throw new AppLoadError('应用尚未安装');

    await this.db
      .update(light_apps)
      .set({ enabled: enabled ? 1 : 0, updated_at: Date.now() })
      .where(eq(light_apps.id, id))
      .run();
    if (!enabled) this.runtimes.delete(id);
    this.logger.info({ appId: id, enabled }, 'Light app toggled');
    return this.toSummary(manifest, { installed: true, enabled });
  }

  /**
   * 获取已就绪的后端子 app；未安装、已禁用或没有 server 入口时返回 null。
   *
   * 子 app 按入口文件 mtime 缓存，源码变更后下一次请求会重新 import。
   *
   * @param id 应用 id
   * @returns 挂载好路由的 Hono 子 app
   * @throws AppLoadError 后端模块加载失败
   */
  async getSubApp(id: string): Promise<Hono | null> {
    const manifest = this.findManifest(id);
    if (!manifest) return null;

    const state = (await this.readStates()).get(id);
    if (!state?.installed || !state.enabled) return null;

    const entry = this.resolveServerEntry(manifest);
    if (!entry) return null;

    const mtimeMs = statSync(entry).mtimeMs;
    const cached = this.runtimes.get(id);
    if (cached && cached.entry === entry && cached.mtimeMs === mtimeMs) {
      return cached.subApp;
    }

    let setup: AppServerSetup;
    try {
      // 查询串做 cache-buster：ESM 按完整 URL 缓存，mtime 变化即可重新加载
      const mod = await import(`${pathToFileURL(entry).href}?mtime=${mtimeMs}`);
      setup = (mod.default ?? mod.setup) as AppServerSetup;
      if (typeof setup !== 'function') {
        throw new AppLoadError(`后端入口 ${entry} 未导出 setup(app, ctx) 函数`);
      }
    } catch (err) {
      if (err instanceof AppLoadError) throw err;
      throw new AppLoadError(`后端模块加载失败：${err instanceof Error ? err.message : String(err)}`);
    }

    const subApp = new Hono();
    const dataDir = this.ensureDataDir(id);
    const ctx: AppServerContext = {
      appId: id,
      dataDir,
      logger: this.logger.child({ appId: id }),
    };

    try {
      await setup(subApp, ctx);
    } catch (err) {
      throw new AppLoadError(`后端初始化失败：${err instanceof Error ? err.message : String(err)}`);
    }

    this.runtimes.set(id, { entry, mtimeMs, subApp });
    this.logger.info({ appId: id, entry }, 'Light app backend mounted');
    return subApp;
  }

  /**
   * 把 `/api/apps/<id>/xxx` 请求转发给应用的子 app（去掉前缀后交给子 app 路由匹配）。
   * @param id 应用 id
   * @param request 原始请求
   * @returns 子 app 的响应；应用不可用时 404
   */
  async handleApi(id: string, request: Request): Promise<Response> {
    const subApp = await this.getSubApp(id);
    if (!subApp) {
      return Response.json({ error: 'App not installed, disabled, or missing server entry' }, { status: 404 });
    }

    const url = new URL(request.url);
    const prefix = `/api/apps/${id}`;
    const rest = url.pathname.slice(prefix.length) || '/';
    const target = new URL(url.href);
    target.pathname = rest;
    return subApp.fetch(new Request(target, request));
  }

  /**
   * 读取应用前端静态文件。
   *
   * 命中真实文件直接返回；未命中且请求看起来是页面导航（无扩展名或 Accept 含
   * text/html）时回退到 index.html，支持前端 SPA 路由。
   *
   * @param id 应用 id
   * @param requestPath 原始请求路径（含 `/app-static/<id>/` 前缀）
   * @returns HTTP 响应
   */
  async serveStatic(id: string, requestPath: string): Promise<Response> {
    const manifest = this.findManifest(id);
    if (!manifest) return new Response('Not Found', { status: 404 });

    const state = (await this.readStates()).get(id);
    if (!state?.installed || !state.enabled) {
      return new Response('App is not installed or disabled', { status: 403 });
    }

    const distDir = resolve(manifest.dir, manifest.manifest.frontend?.dist ?? 'dist');
    const entry = manifest.manifest.frontend?.entry ?? 'index.html';
    const indexPath = resolve(distDir, entry);

    if (!existsSync(indexPath)) {
      return new Response(
        `轻应用 ${id} 尚未构建。请在应用目录执行构建（vico 提供 pnpm app:build ${id}）。`,
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }

    const prefix = `/app-static/${id}`;
    const relRaw = decodeURIComponent(requestPath.slice(prefix.length)).replace(/^\/+/, '');
    const target = resolve(distDir, relRaw);

    // 目录穿越防护：目标必须位于 dist 目录内
    if (target !== distDir && !target.startsWith(distDir + sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    const wantsHtml = requestPath.endsWith('/') || extname(relRaw) === '';
    let isFile = false;
    try {
      isFile = existsSync(target) && statSync(target).isFile();
    } catch {
      isFile = false;
    }
    const filePath = isFile ? target : (wantsHtml ? indexPath : '');
    if (!filePath) return new Response('Not Found', { status: 404 });

    const ext = extname(filePath).toLowerCase();
    const immutable = filePath.includes(`${sep}assets${sep}`);
    const headers: Record<string, string> = {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (ext === '.html') headers['Cache-Control'] = 'no-cache';

    return new Response(readFileSync(filePath), { headers });
  }

  /** 扫描所有目录并解析清单（解析失败的目录也会返回，error 字段说明原因） */
  private scan(): Array<{ manifest: LightAppManifest; dir: string; error?: string }> {
    const results: Array<{ manifest: LightAppManifest; dir: string; error?: string }> = [];
    const seen = new Set<string>();

    for (const scanPath of this.config.scan_paths) {
      const root = expandPath(scanPath);
      let entries: string[];
      try {
        if (!existsSync(root) || !statSync(root).isDirectory()) continue;
        entries = readdirSync(root);
      } catch {
        // 目录不可读时跳过，不影响其它扫描路径
        continue;
      }

      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
        const dir = join(root, entry);
        let isDir = false;
        try {
          isDir = statSync(dir).isDirectory();
        } catch {
          continue;
        }
        if (!isDir) continue;
        if (seen.has(entry)) continue;
        seen.add(entry);

        const manifestPath = join(dir, 'app.json');
        if (!existsSync(manifestPath)) continue;

        try {
          const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
          const parsed = manifestSchema.parse(raw);
          if (parsed.id !== basename(dir)) {
            throw new Error(`app.json 中的 id（${parsed.id}）必须与目录名（${basename(dir)}）一致`);
          }
          results.push({ manifest: parsed, dir });
        } catch (err) {
          // 清单损坏时仍展示该目录，但标记不可安装
          results.push({
            manifest: {
              id: entry,
              name: entry,
              version: '0.0.0',
              description: '',
              icon: '⚠️',
              tags: [],
            },
            dir,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return results;
  }

  /** 读取安装状态：id → { installed, enabled } */
  private async readStates(): Promise<Map<string, { installed: boolean; enabled: boolean }>> {
    const rows = await this.db.select().from(light_apps).all();
    return new Map(rows.map((row) => [row.id, { installed: row.installed === 1, enabled: row.enabled === 1 }]));
  }

  /** 按 id 查找清单 */
  private findManifest(id: string): { manifest: LightAppManifest; dir: string; error?: string } | undefined {
    return this.scan().find((item) => item.manifest.id === id);
  }

  /** 按 id 查找清单，不存在或清单无效时抛错 */
  private requireManifest(id: string): { manifest: LightAppManifest; dir: string } {
    const found = this.findManifest(id);
    if (!found) throw new AppLoadError(`应用 ${id} 不存在`);
    if (found.error) throw new AppLoadError(`应用 ${id} 清单无效：${found.error}`);
    return { manifest: found.manifest, dir: found.dir };
  }

  /** 合并清单与安装状态，生成对外摘要 */
  private toSummary(
    item: { manifest: LightAppManifest; dir: string; error?: string },
    state?: { installed: boolean; enabled: boolean },
  ): LightAppSummary {
    const { manifest, dir, error } = item;
    const serverEntry = this.resolveServerEntry(item);
    const frontendEntry = resolve(dir, manifest.frontend?.dist ?? 'dist', manifest.frontend?.entry ?? 'index.html');

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version ?? '0.0.0',
      description: manifest.description ?? '',
      icon: manifest.icon ?? '🧩',
      author: manifest.author,
      tags: manifest.tags ?? [],
      installed: Boolean(state?.installed),
      enabled: Boolean(state?.installed && state?.enabled),
      hasFrontend: existsSync(resolve(dir, manifest.frontend?.dist ?? 'dist')),
      hasServer: Boolean(serverEntry),
      frontendBuilt: existsSync(frontendEntry),
      devUrl: manifest.dev?.url,
      dir,
      error,
    };
  }

  /** 解析后端入口：清单声明优先，否则按常见文件名探测 */
  private resolveServerEntry(item: { manifest: LightAppManifest; dir: string }): string | undefined {
    const declared = item.manifest.server?.entry;
    if (declared) {
      const entry = resolve(item.dir, declared);
      return existsSync(entry) ? entry : undefined;
    }
    for (const candidate of DEFAULT_SERVER_ENTRIES) {
      const entry = resolve(item.dir, candidate);
      if (existsSync(entry)) return entry;
    }
    return undefined;
  }

  /** 确保应用私有数据目录存在并返回绝对路径 */
  private ensureDataDir(id: string): string {
    const dataDir = resolve(expandPath(this.config.data_dir), id);
    mkdirSync(dataDir, { recursive: true });
    return dataDir;
  }
}
