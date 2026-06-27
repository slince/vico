// src/tool/builtin/find-tool.ts
import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const findParams = z.object({
  pattern: z.string().default('*').describe('Glob pattern to match file names'),
  path: z.string().optional().describe('Directory to search in (default: workspace root)'),
  limit: z.number().int().default(200).describe('Maximum number of files to return'),
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

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
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

async function executeFind(call: ToolCall, ctx: ToolExecutionContext): Promise<z.infer<typeof findOutputSchema>> {
  const args = call.args as unknown as z.infer<typeof findParams>;
  const searchDir = args.path
    ? resolvePath(ctx.session.workspace, args.path)
    : resolve(ctx.session.workspace, '.');

  const regex = globToRegex(args.pattern);
  const results = collectFiles(searchDir, regex, args.limit * 2);

  const sorted = results
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, args.limit)
    .map((r) => relative(ctx.session.workspace, r.path));

  return { files: sorted, count: sorted.length };
}

export const findTool = createTool({
  name: 'find',
  description:
    'Find files by glob pattern in the workspace. Results are sorted by modification time (newest first). Use this to locate files matching a naming pattern.',
  inputSchema: findParams,
  outputSchema: findOutputSchema,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeFind,
});
