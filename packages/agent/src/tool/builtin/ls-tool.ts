// src/tool/builtin/ls-tool.ts
import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { Tool } from '../types.js';

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

export const lsTool: Tool = {
  name: 'ls',
  description:
    'List the contents of a directory in the workspace. Entries are sorted alphabetically with directories marked by a trailing "/". Use this to explore the file structure of the project.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The directory path to list (relative to workspace or absolute, default: workspace root)' },
      limit: { type: 'number', description: 'Maximum number of entries to return (default: 200)' },
    },
    required: [],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  async execute(call, ctx) {
    const args = call.args as { path?: string; limit?: number };
    const limit = args.limit ?? 200;
    const absPath = args.path ? resolvePath(ctx.session.workspace, args.path) : resolve(ctx.session.workspace, '.');

    const stat = statSync(absPath);
    if (!stat.isDirectory()) {
      throw new Error(`"${args.path ?? '.'}" is not a directory`);
    }

    const entries = readdirSync(absPath, { withFileTypes: true });
    const sorted = entries
      .map((d) => d.isDirectory() ? `${d.name}/` : d.name)
      .sort((a, b) => {
        // 目录优先
        const aDir = a.endsWith('/');
        const bDir = b.endsWith('/');
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.localeCompare(b);
      });

    const truncated = sorted.slice(0, limit);
    const rel = args.path ? relative(ctx.session.workspace, absPath) : '.';

    let output = truncated.join('\n');
    if (sorted.length > limit) {
      output += `\n... ${sorted.length - limit} more entries`;
    }
    output += `\n\n${sorted.length} entries in ${rel}`;

    return output;
  },
};
