// @vico/fs-tool - 写入文件工具
import { dirname, relative } from 'node:path';
import { z } from 'zod';
import { localFilesystem, type Filesystem } from '@vico/fs';
import { createTool, resolveWorkspacePath } from '@vico/tool';
import type { ToolCallContext } from '@vico/tool';

const writeParams = z.object({
  path: z.string().describe('要写入的文件路径（相对于工作区或绝对路径）'),
  content: z.string().describe('要写入文件的完整内容'),
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
 * @param fs - 文件系统实现，默认本地文件系统
 */
export function createWriteTool(fs: Filesystem = localFilesystem) {
  return createTool({
    name: 'write',
    description:
      '在工作区创建新文件或覆盖已有文件，父目录不存在时自动创建。',
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

/** write 工具默认实例（使用本地文件系统） */
export const writeTool = createWriteTool();
