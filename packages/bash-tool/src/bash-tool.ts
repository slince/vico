// @vico/bash-tool - Bash 命令执行工具（薄壳，委托 @vico/bash）

import { z } from 'zod';
import type { Tool, ToolCallContext } from '@vico/tool';
import { createTool } from '@vico/tool';
import { resolveWorkspacePath } from '@vico/utils';
import { localCommandExecutor, parseCommand } from '@vico/bash';
import type { CommandExecutor } from '@vico/bash';

const bashParams = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z.number().min(1).max(600000).default(120000).describe('Timeout in milliseconds'),
  dryRun: z.boolean().optional().describe('Preview the command without executing it'),
});

/** Bash 工具的结构化输出 */
const bashOutput = z.object({
  stdout: z.string().describe('Standard output of the command'),
  stderr: z.string().describe('Standard error of the command'),
  exitCode: z.number().int().nullable().describe('Process exit code, or null if unavailable'),
});
type BashOutput = z.infer<typeof bashOutput>;

/**
 * 创建 bash 工具。
 *
 * 命令解析与执行全部委托给 {@link @vico/bash}（`parseCommand` + `CommandExecutor`），
 * 本工具仅负责 schema 校验、工作目录解析与 dryRun 预览。
 *
 * @param options - 可注入自定义执行器，缺省使用 `localCommandExecutor`（`/bin/bash -c`）
 * @returns bash 工具
 */
export function createBashTool(
  { executor = localCommandExecutor }: { executor?: CommandExecutor } = {},
): Tool {
  return createTool({
    name: 'bash',
    description:
      'Execute a shell command in the workspace root and return its standard output, standard error and exit code. Supports a timeout (default 120000ms). Set dryRun=true to preview the command without executing it.',
    inputSchema: bashParams,
    outputSchema: bashOutput,
    policy: 'auto',
    kind: 'mutation',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof bashParams>, ctx: ToolCallContext): Promise<BashOutput> {
      const cwd = resolveWorkspacePath(ctx.session.workspace!, '.');

      if (args.dryRun) {
        return { stdout: `[DRY RUN] Would execute in ${cwd}:\n  ${args.command}`, stderr: '', exitCode: null };
      }

      const cmd = parseCommand(args.command, { cwd, timeout: args.timeout });
      const result = await executor.execute(cmd);

      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    },
  });
}

/** 默认 bash 工具单例：以 `/bin/bash -c` 本地执行器派发命令 */
export const bashTool: Tool = createBashTool();
