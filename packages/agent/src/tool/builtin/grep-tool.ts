// src/tool/builtin/grep-tool.ts
import {execSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import type {Tool} from '../types.js';

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  limit?: number;
  '-i'?: boolean;
  context?: number;
}

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

/** 尝试使用系统 ripgrep，失败则回退到 Node 正则 */
function ripgrep(args: GrepArgs, searchDir: string): string {
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
    if (err.status === 1) return 'No matches found'; // rg exits 1 when no match
    // rg not available, fall through to Node fallback
    return '';
  }
}

/** glob → 正则 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Node.js 暴力搜索 */
function nodeGrep(args: GrepArgs, searchDir: string): string {
  const patternFlags = args['-i'] ? 'gi' : 'g';
  const regex = new RegExp(args.pattern, patternFlags);
  const filePattern = args.glob ? globToRegex(args.glob) : null;
  const results: string[] = [];
  const maxResults = args.limit ?? 200;

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
              const match = lines[i].match(regex);
              if (match) {
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
    // single file
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

  return results.length > 0 ? results.join('\n') : 'No matches found';
}

export const grepTool: Tool = {
  name: 'grep',
  description:
    'Search file contents using a regular expression pattern. Supports glob pattern filtering, case-insensitive search, and context lines. Uses system ripgrep (rg) when available, falling back to Node.js regex.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression pattern to search for' },
      path: { type: 'string', description: 'Directory or file path to search in (default: workspace root)' },
      glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts", "**/*.test.ts")' },
      limit: { type: 'number', description: 'Maximum number of matches to return (default: 200)' },
      '-i': { type: 'boolean', description: 'Case insensitive search' },
      context: { type: 'number', description: 'Number of context lines to show around each match' },
    },
    required: ['pattern'],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  async execute(call, ctx) {
    const args = call.args as unknown as GrepArgs;
    if (!args.pattern || typeof args.pattern !== 'string') {
      throw new Error('"pattern" is required and must be a string');
    }

    const searchDir = args.path ? resolvePath(ctx.session.workspace, args.path) : resolve(ctx.session.workspace, '.');

    // 优先尝试 ripgrep
    const rgOutput = ripgrep(args, searchDir);
    if (rgOutput) return rgOutput;

    // 回退到 Node
    return nodeGrep(args, searchDir);
  },
};
