/**
 * 轻应用构建 CLI — 在应用目录执行前端构建，产物输出到清单声明的 frontend.dist。
 *
 * 用法：
 *   pnpm --filter @vico/server app:build            # 构建全部应用
 *   pnpm --filter @vico/server app:build snake-demo # 只构建指定应用
 *
 * 优先执行应用 package.json 里的 `build` 脚本；未声明时回退到 `pnpm exec vite build`。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || resolve(__dirname, '../../server.config.yaml');

/** 展开 `~` 前缀为绝对路径 */
function expandPath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

/** 读取 server.config.yaml 中 apps.scan_paths（缺省为 ~/vico/apps） */
function scanPaths(): string[] {
  try {
    const config = parse(readFileSync(CONFIG_PATH, 'utf8')) as { apps?: { scan_paths?: string[] } };
    return config.apps?.scan_paths ?? ['~/vico/apps'];
  } catch {
    return ['~/vico/apps'];
  }
}

/** 收集待构建应用目录 */
function collectApps(only?: string): Array<{ id: string; dir: string }> {
  const apps: Array<{ id: string; dir: string }> = [];
  for (const scanPath of scanPaths()) {
    const root = expandPath(scanPath);
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const dir = join(root, entry);
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'app.json'))) continue;
      if (only && entry !== only) continue;
      apps.push({ id: entry, dir });
    }
  }
  return apps;
}

/** 执行单个应用的构建命令 */
function buildApp(app: { id: string; dir: string }): boolean {
  const pkgPath = join(app.dir, 'package.json');
  const hasBuildScript = existsSync(pkgPath)
    && Boolean((JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }).scripts?.build);

  const args = hasBuildScript ? ['build'] : ['exec', 'vite', 'build'];

  console.log(`\n▶ Building ${app.id} (pnpm ${args.join(' ')})`);
  const result = spawnSync('pnpm', args, { cwd: app.dir, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`✖ Build failed for ${app.id}`);
    return false;
  }
  console.log(`✔ Built ${app.id}`);
  return true;
}

const only = process.argv[2];
const apps = collectApps(only);
if (apps.length === 0) {
  console.error(only ? `未找到应用 ${only}` : '未在 scan_paths 中找到任何应用');
  process.exit(1);
}

let failed = false;
for (const app of apps) {
  if (!buildApp(app)) failed = true;
}
process.exit(failed ? 1 : 0);
