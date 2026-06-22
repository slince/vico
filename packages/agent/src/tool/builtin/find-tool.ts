// src/tool/builtin/find-tool.ts
import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { Tool } from '../types.js';

interface FindArgs {
  pattern?: string;
  path?: string;
  limit?: number;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

export const findTool: Tool = {
  name: 'find',
  description:
    'Find files by glob pattern in the workspace. Results are sorted by modification time (newest first). Use this to locate files matching a naming pattern.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match file names (e.g. "*.ts", "**/*.test.ts"). Default: "*"' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
      limit: { type: 'number', description: 'Maximum number of files to return (default: 200)' },
    },
    required: [],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  async execute(call, ctx) {
    const args = call.args as FindArgs;
    const pattern = args.pattern ?? '*';
    const limit = args.limit ?? 200;
    const searchDir = args.path ? resolvePath(ctx.session.workspace, args.path) : resolve(ctx.session.workspace, '.');

    const regex = globToRegex(pattern);
    const results: Array<{ path: string; mtime: number }> = [];

    function walk(dir: string) {
      if (results.length >= limit * 2) return; // overscan for sorting
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            if (regex.test(entry.name)) {
              try {
                const stat = statSync(fullPath);
                results.push({ path: fullPath, mtime: stat.mtimeMs });
              } catch {
                results.push({ path: fullPath, mtime: 0 });
              }
            }
          }
        }
      } catch {
        // skip unreadable directories
      }
    }

    const startPath = statSync(searchDir).isDirectory() ? searchDir : searchDir;
    walk(startPath);

    const sorted = results
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((r) => relative(ctx.session.workspace, r.path));

    if (sorted.length === 0) {
      return `No files found matching "${pattern}"`;
    }

    let output = sorted.join('\n');
    if (results.length > limit) {
      output += `\n... ${results.length - limit} more files`;
    }
    return output;
  },
};
