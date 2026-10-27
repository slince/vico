// @vico/fs-tool - 写入文件工具
import { dirname, relative } from 'node:path';
import { z } from 'zod';
import type { Filesystem } from '@vico/fs';
import { createTool } from '@vico/tool';
import { resolveWorkspacePath } from '@vico/utils';
import type { ToolCallContext } from '@vico/tool';

const writeParams = z.object({
  path: z.string().describe('File path to write (relative to workspace or absolute)'),
  content: z.string().describe('Full content to write to the file'),
});

const writeOutputSchema = z.object({
  action: z.enum(['created', 'updated']),
  path: z.string(),
  lines: z.number().int(),
  size: z.number().int(),
});

type WriteOutput = z.infer<typeof writeOutputSchema>;

/**
 * 创建 write 工具 — 在工作区创建新文件或覆盖已有文件，父目录不存在时自动创建。
 * @param fs - 文件系统实现（由装配层注入）
 */
export function createWriteTool(fs: Filesystem) {
  return createTool({
    name: 'write',
    description:
      'Create a new file in the workspace or overwrite an existing one. Parent directories are created automatically.',
    inputSchema: writeParams,
    outputSchema: writeOutputSchema,
    policy: 'auto',
    kind: 'mutation',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof writeParams>, ctx: ToolCallContext): Promise<WriteOutput> {
      const workspace = ctx.session.workspace!;
      const absPath = resolveWorkspacePath(workspace, args.path);
      const dir = dirname(absPath);

      await fs.mkdir(dir, { recursive: true });

      const existed = await fs.exists(absPath);
      await fs.writeFile(absPath, args.content);

      const rel = relative(workspace, absPath);
      const action = existed ? 'updated' as const : 'created' as const;
      const lines = args.content.split('\n').length;
      const size = Buffer.byteLength(args.content, 'utf-8');

      return { action, path: rel, lines, size };
    },
  });
}
