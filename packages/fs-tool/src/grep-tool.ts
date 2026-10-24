// @vico/fs-tool - grep 搜索文件工具
import { z } from 'zod';
import { createTool } from '@vico/tool';
import { resolveWorkspacePath } from '@vico/utils';
import type { ToolCallContext } from '@vico/tool';
import { runRipgrep, toWorkdirRelative } from './ripgrep.js';

const grepParams = z.object({
  pattern: z.string().describe('Regular expression to search for'),
  path: z.string().optional().describe('File or directory to search'),
  glob: z.string().optional().describe('Glob pattern to filter file names'),
  limit: z.number().int().default(200).describe('Maximum number of matches to return'),
  '-i': z.boolean().optional().describe('Ignore case'),
});

/**
 * 构造 rg --json 参数向量。用 `--regexp=` / `--glob=` / `--` 形式承载模型输入，
 * 无 shell 层，leading-dash 值不会误解析为 flag。
 */
function buildGrepArgv(args: z.infer<typeof grepParams>, path?: string): string[] {
  const parts = ['--json', `--regexp=${args.pattern}`];
  if (args['-i']) parts.push('--ignore-case');
  if (args.glob) parts.push(`--glob=${args.glob}`);
  if (path !== undefined) parts.push('--', path);
  return parts;
}

/** rg --json 解析出的一条匹配 */
interface GrepMatch {
  path: string;
  lineNumber: number;
  line: string;
}

/**
 * 解析 rg --json 的 NDJSON stdout，只取 `match` 记录。
 * 非 match 记录（begin/end/context/summary）是传输框架，跳过；match 记录缺字段视为 malformed。
 */
function parseGrepMatches(stdout: string): GrepMatch[] {
  const matches: GrepMatch[] = [];

  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;

    let record: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string; bytes?: string } } };
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error('ripgrep returned malformed --json output');
    }

    if (record.type !== 'match') continue;

    const data = record.data;
    const pathText = data?.path?.text;
    const lineNumber = data?.line_number;
    const lineText = typeof data?.lines?.text === 'string'
      ? data.lines.text
      : typeof data?.lines?.bytes === 'string' ? '(line is not valid UTF-8)' : undefined;

    if (typeof pathText !== 'string' || typeof lineNumber !== 'number' || typeof lineText !== 'string') {
      throw new Error('ripgrep returned a malformed match record');
    }

    matches.push({ path: pathText, lineNumber, line: lineText.replace(/\r?\n$/, '') });
  }

  return matches;
}

const grepOutputSchema = z.object({
  matches: z.string(),
  count: z.number().int(),
});

type GrepOutput = z.infer<typeof grepOutputSchema>;

/**
 * 创建 grep 工具 — 用打包的 ripgrep（rg --json）搜索文件内容，返回带行号的匹配行。
 */
export function createGrepTool() {
  return createTool({
    name: 'grep',
    description:
      'Search file contents with a regular expression. Returns matching lines with line numbers.',
    inputSchema: grepParams,
    outputSchema: grepOutputSchema,
    policy: 'auto',
    kind: 'readonly',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof grepParams>, ctx: ToolCallContext): Promise<GrepOutput> {
      const workspace = ctx.session.workspace!;
      const cwd = resolveWorkspacePath(workspace, '.');
      const searchPath = args.path ? resolveWorkspacePath(workspace, args.path) : undefined;

      const { stdout, noMatches } = await runRipgrep(buildGrepArgv(args, searchPath), {
        cwd,
        signal: ctx.signal,
      });

      if (noMatches) return { matches: 'No matches found', count: 0 };

      const all = parseGrepMatches(stdout);
      const limited = all.slice(0, args.limit);
      const matches = limited
        .map((m) => `${toWorkdirRelative(m.path, cwd)}:${m.lineNumber}:${m.line}`)
        .join('\n');

      return { matches: matches || 'No matches found', count: limited.length };
    },
  });
}

/** grep 工具默认实例 */
export const grepTool = createGrepTool();
