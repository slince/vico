// @vico/fs-tool - glob 查找文件工具
import { z } from 'zod';
import { createTool, resolveWorkspacePath } from '@vico/tool';
import type { ToolCallContext } from '@vico/tool';
import { runRipgrep, toWorkdirRelative } from './ripgrep.js';

const globParams = z.object({
  pattern: z.string().default('*').describe('Glob pattern to match file names'),
  path: z.string().optional().describe('Directory to search (default: workspace root)'),
  limit: z.number().int().default(200).describe('Maximum number of files to return'),
});

/**
 * 目录名排除清单：`--no-ignore --hidden` 会浮出被忽略/隐藏的内容，
 * VCS 元数据与 node_modules 属纯噪音，须显式排除。
 */
const GLOB_DIR_EXCLUDES = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl', 'node_modules'];

/**
 * 构造 rg --files 参数向量。每个受模型控制的值都是独立 argv 元素（无 shell 层），
 * 搜索根放在 `--` 之后，避免 leading-dash 路径被解析为 flag。
 */
function buildGlobArgv(pattern: string, path?: string): string[] {
  return [
    '--files',
    `--glob=${pattern}`,
    '--sort=modified',
    '--no-ignore',
    '--hidden',
    ...GLOB_DIR_EXCLUDES.flatMap((name) => [`--glob=!**/${name}`, `--glob=!**/${name}/**`]),
    ...(path !== undefined ? ['--', path] : []),
  ];
}

const globOutputSchema = z.object({
  files: z.array(z.string()),
  count: z.number().int(),
});

type GlobOutput = z.infer<typeof globOutputSchema>;

/**
 * 创建 glob 工具 — 用打包的 ripgrep（rg --files）发现文件，按修改时间排序（最新在前）。
 */
export function createGlobTool() {
  return createTool({
    name: 'glob',
    description:
      'Find files in the workspace by glob pattern, sorted by modification time (newest first). Use to locate files by naming pattern.',
    inputSchema: globParams,
    outputSchema: globOutputSchema,
    policy: 'auto',
    kind: 'readonly',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof globParams>, ctx: ToolCallContext): Promise<GlobOutput> {
      const workspace = ctx.session.workspace!;
      const cwd = resolveWorkspacePath(workspace, '.');
      const searchPath = args.path ? resolveWorkspacePath(workspace, args.path) : undefined;

      const { stdout, noMatches } = await runRipgrep(buildGlobArgv(args.pattern, searchPath), {
        cwd,
        signal: ctx.signal,
      });

      if (noMatches) return { files: [], count: 0 };

      const files: string[] = [];
      for (const line of stdout.split('\n')) {
        if (line.length === 0) continue;
        files.push(toWorkdirRelative(line, cwd));
      }

      const limited = files.slice(0, args.limit);
      return { files: limited, count: limited.length };
    },
  });
}

/** glob 工具默认实例 */
export const globTool = createGlobTool();
