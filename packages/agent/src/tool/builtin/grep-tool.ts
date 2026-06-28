// src/tool/builtin/grep-tool.ts
import {execSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const grepParams = z.object({
  pattern: z.string().describe('要搜索的正则表达式'),
  path: z.string().optional().describe('搜索目录或文件路径'),
  glob: z.string().optional().describe('文件名过滤的 glob 模式'),
  limit: z.number().int().default(200).describe('返回匹配的最大数量'),
  '-i': z.boolean().optional().describe('忽略大小写'),
  context: z.number().int().optional().describe('每个匹配周围的上下文行数'),
});

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

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
    return limited.join('\n') || '未找到匹配';
  } catch (err: any) {
    if (err.status === 1) return '未找到匹配';
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

function nodeGrep(args: z.infer<typeof grepParams>, searchDir: string): string {
  const patternFlags = args['-i'] ? 'gi' : 'g';
  const regex = new RegExp(args.pattern, patternFlags);
  const filePattern = args.glob ? globToRegex(args.glob) : null;
  const results: string[] = [];
  const maxResults = args.limit;

  function walk(dir: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          if (filePattern && !filePattern.test(entry.name)) continue;
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;
              if (regex.test(lines[i])) {
                const rel = relative(args.path ? resolvePath('.', args.path) : '.', fullPath);
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

  const startPath = existsSync(searchDir) && statSync(searchDir).isDirectory() ? searchDir : searchDir;
  if (statSync(startPath).isDirectory()) {
    walk(startPath);
  } else {
    try {
      const content = readFileSync(startPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${relative('.', startPath)}:${i + 1}:${lines[i].trim()}`);
        }
      }
    } catch {
      // skip
    }
  }

  return results.length > 0 ? results.join('\n') : '未找到匹配';
}

const grepOutputSchema = z.object({
  matches: z.string(),
  count: z.number().int(),
});

async function executeGrep(call: ToolCall, ctx: ToolExecutionContext): Promise<z.infer<typeof grepOutputSchema>> {
  const args = call.args as unknown as z.infer<typeof grepParams>;
  const searchDir = args.path ? resolvePath(ctx.session.workspace, args.path) : resolve(ctx.session.workspace, '.');

  const rgOutput = ripgrep(args, searchDir);
  const matches = rgOutput || nodeGrep(args, searchDir);
  const count = matches === '未找到匹配' || matches === '' ? 0 : matches.split('\n').length;
  return { matches, count };
}

export const grepTool = createTool({
  name: 'grep',
  description:
    '使用正则表达式搜索文件内容。支持 glob 过滤、忽略大小写和上下文行。优先使用系统 ripgrep (rg)，不可用时回退到 Node.js 正则。',
  inputSchema: grepParams,
  outputSchema: grepOutputSchema,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeGrep,
});
