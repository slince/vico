// src/tool/builtin/find-tool.ts
import {readdirSync, statSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

const findParams = z.object({
  pattern: z.string().default('*').describe('匹配文件名的 glob 模式'),
  path: z.string().optional().describe('搜索目录（默认：工作区根目录）'),
  limit: z.number().int().default(200).describe('返回文件的最大数量'),
});

interface FindResult {
  path: string;
  mtime: number;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function collectFiles(searchDir: string, regex: RegExp, maxResults: number): FindResult[] {
  const results: FindResult[] = [];

  function walk(dir: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && regex.test(entry.name)) {
          try {
            const stat = statSync(fullPath);
            results.push({ path: fullPath, mtime: stat.mtimeMs });
          } catch {
            results.push({ path: fullPath, mtime: 0 });
          }
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  walk(searchDir);
  return results;
}

const findOutputSchema = z.object({
  files: z.array(z.string()),
  count: z.number().int(),
});

async function executeFind(args: z.infer<typeof findParams>, ctx: ToolCallContext): Promise<z.infer<typeof findOutputSchema>> {
  const workspace = ctx.session.workspace!;

  const searchDir = args.path
    ? resolveWorkspacePath(workspace, args.path)
    : resolve(workspace, '.');

  const regex = globToRegex(args.pattern);
  const results = collectFiles(searchDir, regex, args.limit * 2);

  const sorted = results
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, args.limit)
    .map((r) => relative(workspace, r.path));

  return { files: sorted, count: sorted.length };
}

export const findTool = createTool({
  name: 'find',
  description:
    '通过 glob 模式在工作区查找文件，按修改时间排序（最新在前）。用于按命名模式定位文件。',
  inputSchema: findParams,
  outputSchema: findOutputSchema,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeFind,
});
