/**
 * Workspace 文件系统 API — 前端文件浏览器后端。
 *
 * 工作目录解析优先级：
 * 1. thread.metadata.workspace（通过 chdir 设置，持久化到 ThreadStore）
 * 2. agent.workspace（从 AgentConfig 取得）
 * 3. 空（返回空列表）
 */
import { Hono } from 'hono';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { homedir } from 'node:os';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { resolveWorkspacePath } from '@vico/tool';
import { getThreadStore } from '../vico.js';
import { getThreadWorkspace } from '../lib/workspace.js';

const MAX_READ_BYTES = 1_048_576; // 1 MB

/**
 * 检测文件是否为二进制（null byte 启发式）。
 * 检查缓冲区前 1024 字节中 null 字节的数量，超过 3 个则判定为二进制。
 */
function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let nullCount = 0;
  for (const byte of sample) {
    if (byte === 0) nullCount++;
    if (nullCount > 3) return true;
  }
  return false;
}

/** 将原始路径解析为绝对路径：~ 展开、相对路径基于 home、最后 resolve 规范化 */
function resolveBrowsePath(rawPath: string): string {
  const absPath = rawPath.startsWith('~')
    ? join(homedir(), rawPath.slice(1))
    : rawPath.startsWith('/')
      ? rawPath
      : join(homedir(), rawPath);
  return resolve(absPath);
}

/**
 * 列出指定目录下的子目录（隐藏点文件），返回浏览结果。
 * 非目录返回带 status 的错误对象，由调用方决定如何响应。
 */
function listSubDirectories(
  absPath: string,
): { path: string; parent: string; entries: { name: string; isDirectory: boolean }[] } | { error: string; status: 400 } {
  const stat = statSync(absPath);
  if (!stat.isDirectory()) {
    return { error: 'Not a directory', status: 400 };
  }

  const raw = readdirSync(absPath, { withFileTypes: true });
  const entries = raw
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isDirectory: true }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { path: absPath, parent: dirname(absPath), entries };
}

/** 将 workspace 路径写入 thread.metadata */
async function bindThreadWorkspace(threadId: string, workspace: string): Promise<void> {
  const store = getThreadStore();

  const thread = await store.getThread(threadId);
  const metadata = { ...(thread?.metadata ?? {}), workspace };
  await store.updateThread(threadId, { metadata });
}

/** 清除 thread.metadata.workspace */
async function unbindThreadWorkspace(threadId: string): Promise<void> {
  const store = getThreadStore();

  const thread = await store.getThread(threadId);
  if (!thread?.metadata?.workspace) return;

  const metadata = { ...thread.metadata };
  delete metadata.workspace;
  await store.updateThread(threadId, { metadata });
}

export function fsRoutes(app: Hono<{ Variables: Variables }>) {
  /**
   * GET /api/v1/threads/:threadId/fs/listdir?path=
   *
   * 列指定路径下的条目（目录 + 文件）。path 为相对当前工作目录的路径，
   * 省略 = 工作目录根。返回 entries 含 name / isDirectory / size，目录优先 + 字母序。
   */
  app.get('/api/v1/threads/:threadId/fs/listdir', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const subPath = c.req.query('path') || '';
    const workspace = await getThreadWorkspace(threadId);
    if (!workspace) return c.json({ entries: [], path: '.' });

    try {
      const absPath = subPath
        ? resolveWorkspacePath(workspace, subPath)
        : resolve(workspace, '.');

      let stat;
      try {
        stat = statSync(absPath);
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          return c.json({ entries: [], path: subPath || '.' });
        }
        throw e;
      }
      if (!stat.isDirectory()) {
        return c.json({ error: 'Not a directory' }, 400);
      }

      const raw = readdirSync(absPath, { withFileTypes: true });
      const entries = raw
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => {
          const entry: { name: string; isDirectory: boolean; size?: number } = {
            name: e.name,
            isDirectory: e.isDirectory(),
          };
          if (e.isFile()) {
            try {
              entry.size = statSync(join(absPath, e.name)).size;
            } catch { /* ignore */ }
          }
          return entry;
        })
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

      return c.json({ entries, path: subPath || '.', cwd: workspace });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list directory';
      const status = msg.includes('outside') ? 403 : msg.includes('Not a') ? 400 : 500;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * GET /api/v1/threads/:threadId/fs/browse?path=
   *
   * 浏览服务器文件系统中的目录，供前端文件夹选择器使用。
   * path 为绝对路径（支持 ~ 前缀）；省略时默认当前 workspace，无则回退到 home。
   * 仅返回子目录，隐藏点文件，用于逐级下钻选择目录。
   */
  app.get('/api/v1/threads/:threadId/fs/browse', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const rawPath = c.req.query('path');

    // 解析目标目录：显式 path（支持 ~ / 相对 home）优先，否则回退当前 workspace / home
    let absPath: string;
    if (rawPath) {
      absPath = resolveBrowsePath(rawPath);
    } else {
      const workspace = await getThreadWorkspace(threadId);
      absPath = workspace || homedir();
    }
    absPath = resolve(absPath);

    try {
      const result = listSubDirectories(absPath);
      if ('error' in result) return c.json({ error: result.error }, result.status);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to browse directory';
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * GET /api/v1/fs/browse?path=
   *
   * 全局目录浏览端点，供新会话（尚无真实 threadId）选择 workspace 使用。
   * path 为绝对路径（支持 ~ 前缀 / 相对 home）；省略时默认 home。
   * 仅返回子目录，隐藏点文件，用于逐级下钻选择目录。
   */
  app.get('/api/v1/fs/browse', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const rawPath = c.req.query('path');
    const absPath = rawPath ? resolveBrowsePath(rawPath) : resolve(homedir());

    try {
      const result = listSubDirectories(absPath);
      if ('error' in result) return c.json({ error: result.error }, result.status);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to browse directory';
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * GET /api/v1/threads/:threadId/fs/read?path=
   *
   * 读取工作目录内的文本文件。二进制文件返回提示文本。
   * 文件超过 1MB 或 50000 字符会被截断。
   */
  app.get('/api/v1/threads/:threadId/fs/read', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path is required' }, 400);

    const workspace = await getThreadWorkspace(threadId);
    if (!workspace) return c.json({ error: 'Workspace not configured' }, 404);

    try {
      const absPath = resolveWorkspacePath(workspace, filePath);
      const stat = statSync(absPath);
      if (!stat.isFile()) return c.json({ error: 'Not a file' }, 400);
      if (stat.size > MAX_READ_BYTES) {
        return c.json({ error: `File too large (${(stat.size / 1024 / 1024).toFixed(2)} MB > 1 MB limit)` }, 413);
      }

      const buffer = readFileSync(absPath);
      if (isBinary(buffer)) {
        return c.json({
          path: filePath,
          absolutePath: absPath,
          content: `[Binary file: ${filePath} (${stat.size} bytes)]`,
          type: 'binary',
          size: stat.size,
          truncated: false,
          cwd: workspace,
        });
      }

      const raw = buffer.toString('utf-8');
      const MAX_CHARS = 50_000;
      const truncated = raw.length > MAX_CHARS;
      const content = truncated
        ? raw.slice(0, MAX_CHARS) + `\n\n[TRUNCATED at ${MAX_CHARS} chars]`
        : raw;

      return c.json({
        path: filePath,
        absolutePath: absPath,
        content,
        type: 'text',
        size: stat.size,
        truncated,
        cwd: workspace,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read file';
      const status = msg.includes('outside') ? 403 : 500;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * POST /api/v1/threads/:threadId/fs/write
   *
   * 写入工作目录内的文件（自动创建父目录）。
   * Body: { path: string, content: string }
   */
  app.post('/api/v1/threads/:threadId/fs/write', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const raw = await c.req.json().catch(() => null);
    if (!raw || !raw.path || typeof raw.content !== 'string') {
      return c.json({ error: 'Invalid body: path and content required' }, 400);
    }

    const { path: filePath, content } = raw as { path: string; content: string };
    const workspace = await getThreadWorkspace(threadId);
    if (!workspace) return c.json({ error: 'Workspace not configured' }, 404);

    try {
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > 100 * 1024) {
        return c.json({ error: `Content too large (${(bytes / 1024).toFixed(1)} KB > 100 KB limit)` }, 413);
      }

      const absPath = resolveWorkspacePath(workspace, filePath);
      mkdirSync(join(absPath, '..'), { recursive: true });
      writeFileSync(absPath, content, 'utf8');

      return c.json({
        path: filePath,
        absolutePath: absPath,
        cwd: workspace,
        bytes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to write file';
      const status = msg.includes('outside') ? 403 : 500;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * POST /api/v1/threads/:threadId/fs/chdir
   *
   * 切换线程的工作目录，持久化到 thread.metadata.workspace。
   * Body: { path: string }
   */
  app.post('/api/v1/threads/:threadId/fs/chdir', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw.path !== 'string') {
      return c.json({ error: 'Invalid body: path required' }, 400);
    }

    const targetPath = raw.path as string;
    let absPath: string;
    try {
      if (targetPath.startsWith('~')) {
        absPath = join(homedir(), targetPath.slice(1));
      } else if (targetPath.startsWith('/')) {
        absPath = targetPath;
      } else {
        absPath = join(homedir(), targetPath);
      }
    } catch {
      return c.json({ error: 'Invalid path' }, 400);
    }

    if (!existsSync(absPath)) {
      return c.json({ error: 'Directory not found' }, 404);
    }
    if (!statSync(absPath).isDirectory()) {
      return c.json({ error: 'Not a directory' }, 400);
    }

    await bindThreadWorkspace(threadId, absPath);

    return c.json({
      cwd: absPath,
      bound: true,
    });
  });

  /**
   * GET /api/v1/threads/:threadId/fs/chdir
   *
   * 获取当前线程的工作目录信息。
   */
  app.get('/api/v1/threads/:threadId/fs/chdir', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const workspace = await getThreadWorkspace(threadId);

    // 判断是否显式绑定
    let bound = false;
    const store = getThreadStore();
    const thread = await store.getThread(threadId);
    bound = !!thread?.metadata?.workspace;

    return c.json({
      cwd: workspace || null,
      bound,
      empty: !workspace,
    });
  });

  /**
   * DELETE /api/v1/threads/:threadId/fs/chdir
   *
   * 清除线程的工作目录绑定，回退到默认 workspace。
   */
  app.delete('/api/v1/threads/:threadId/fs/chdir', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    await unbindThreadWorkspace(threadId);

    const workspace = await getThreadWorkspace(threadId);
    return c.json({
      cwd: workspace || null,
      bound: false,
      empty: !workspace,
    });
  });
}
