// @vico/fs-tool - grep 搜索文件工具
import { execSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { localFilesystem, type Filesystem } from '@vico/fs';
import { createTool, resolveWorkspacePath } from '@vico/tool';
import type { ToolCallContext } from '@vico/tool';

const grepParams = z.object({
  pattern: z.string().describe('Regular expression to search for'),
  path: z.string().optional().describe('Directory or file path to search'),
  glob: z.string().optional().describe('Glob pattern to filter file names'),
  limit: z.number().int().default(200).describe('Maximum number of matches to return'),
  '-i': z.boolean().optional().describe('Ignore case'),
  context: z.number().int().optional().describe('Number of context lines around each match'),
});

function ripgrep(args: z.infer<typeof grepParams>, searchDir: string): string {
  const flags: string[] = ['--color=never', '--no-heading', '-n', '--no-ignore'];
  if (args['-i']) flags.push('-i');
  if (args.context) flags.push('-C', String(args.context));
  if (args.glob) flags.push('-g', args.glob);
  if (args.limit) flags.push('-m', String(args.limit));

  try {
    const result = execSync(`rg ${flags.join(' ')} ${JSON.stringify(args.pattern)} ${JSON.stringify(searchDir)}`, {
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = result.trim().split('\n').filter(Boolean);
    const limited = args.limit ? lines.slice(0, args.limit) : lines;
    return limited.join('\n') || 'No matches found';
  } catch (err: any) {
    if (err.status === 1) return 'No matches found';
    return '';
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** ripgrep 不可用时的 Node.js 正则回退实现 */
async function nodeGrep(fs: Filesystem, args: z.infer<typeof grepParams>, searchDir: string): Promise<string> {
  const patternFlags = args['-i'] ? 'gi' : 'g';
  const regex = new RegExp(args.pattern, patternFlags);
  const filePattern = args.glob ? globToRegex(args.glob) : null;
  const results: string[] = [];
  const maxResults = args.limit;

  async function walk(dir: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = await fs.readDir(dir);
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory) {
          await walk(fullPath);
        } else if (entry.isFile) {
          if (filePattern && !filePattern.test(entry.name)) continue;
          try {
            const content = await fs.readTextFile(fullPath);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;
              if (regex.test(lines[i])) {
                const rel = relative(args.path ? resolve('.', args.path) : '.', fullPath);
                results.push(`${rel}:${i + 1}:${lines[i].trim()}`);
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  let stat;
  try {
    stat = await fs.stat(searchDir);
  } catch {
    return 'No matches found';
  }

  if (stat.isDirectory) {
    await walk(searchDir);
  } else {
    try {
      const content = await fs.readTextFile(searchDir);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${relative('.', searchDir)}:${i + 1}:${lines[i].trim()}`);
        }
      }
    } catch {
      // skip
    }
  }

  return results.length > 0 ? results.join('\n') : 'No matches found';
}

const grepOutputSchema = z.object({
  matches: z.string(),
  count: z.number().int(),
});

type GrepOutput = z.infer<typeof grepOutputSchema>;

/**
 * 创建 grep 工具 — 正则搜索文件内容，优先 ripgrep，不可用时回退 Node 正则。
 * @param fs - 文件系统实现，默认本地文件系统
 */
export function createGrepTool(fs: Filesystem = localFilesystem) {
  return createTool({
    name: 'grep',
    description:
      'Search file contents with a regular expression. Supports glob filtering, case-insensitive matching, and context lines. Prefers system ripgrep (rg) and falls back to Node.js regex.',
    inputSchema: grepParams,
    outputSchema: grepOutputSchema,
    policy: 'auto',
    kind: 'readonly',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof grepParams>, ctx: ToolCallContext): Promise<GrepOutput> {
      const workspace = ctx.session.workspace!;
      const searchDir = args.path ? resolveWorkspacePath(workspace, args.path) : resolve(workspace, '.');

      const rgOutput = ripgrep(args, searchDir);
      const matches = rgOutput || await nodeGrep(fs, args, searchDir);
      const count = matches === 'No matches found' || matches === '' ? 0 : matches.split('\n').length;
      return { matches, count };
    },
  });
}

/** grep 工具默认实例（使用本地文件系统） */
export const grepTool = createGrepTool();
