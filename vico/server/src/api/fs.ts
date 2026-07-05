/**
 * Workspace 文件系统 API — 前端文件浏览器后端。
 *
 * 每个 thread 的 workspace = config.workspace.base_path + '/' + threadId，
 * 复用 @vico/agent 的 resolveWorkspacePath 做路径沙箱校验。
 */
import { Hono } from 'hono';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { config } from '../config.js';
import { resolveWorkspacePath } from '@vico/agent';

const MAX_READ_BYTES = 1_048_576; // 1 MB

/** 构建 thread 的 workspace 绝对路径 */
function getThreadWorkspace(threadId: string): string {
  return resolve(config.workspace.base_path, threadId);
}

/**
 * 检测文件是否为二进制（null byte 启发式，与 agent readTool 一致）。
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

export function fsRoutes(app: Hono<{ Variables: Variables }>) {
  /**
   * GET /api/v1/threads/:threadId/fs/listdir?path=
   *
   * 列指定路径下的条目（目录 + 文件）。path 为相对 workspace 的路径，省略 = 根目录。
   * 返回 entries 含 name / isDirectory / size，目录优先 + 字母序。
   */
  app.get('/api/v1/threads/:threadId/fs/listdir', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const subPath = c.req.query('path') || '';
    const workspace = getThreadWorkspace(threadId);

    try {
      const absPath = subPath
        ? resolveWorkspacePath(workspace, subPath)
        : resolve(workspace, '.');

      const stat = statSync(absPath);
      if (!stat.isDirectory()) {
        return c.json({ error: 'Not a directory' }, 400);
      }

      const raw = readdirSync(absPath, { withFileTypes: true });
      const entries = raw
        .filter((e) => !e.name.startsWith('.')) // 隐藏 dotfile
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

      return c.json({ entries, path: subPath || '.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list directory';
      const status = msg.includes('outside') ? 403 : msg.includes('Not a') ? 400 : 500;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * GET /api/v1/threads/:threadId/fs/read?path=
   *
   * 读取 workspace 内的文本文件。二进制文件返回提示文本。
   * 文件超过 1MB 或 50000 字符会被截断。
   */
  app.get('/api/v1/threads/:threadId/fs/read', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path is required' }, 400);

    const workspace = getThreadWorkspace(threadId);

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
   * 写入 workspace 内的文件（自动创建父目录）。
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
    const workspace = getThreadWorkspace(threadId);

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
}
