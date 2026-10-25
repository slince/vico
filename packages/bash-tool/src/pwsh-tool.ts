// @vico/bash-tool - PowerShell 命令执行工具（薄壳，委托 @vico/bash）

import { z } from 'zod';
import type { Tool, ToolCallContext } from '@vico/tool';
import { createTool } from '@vico/tool';
import { resolveWorkspacePath } from '@vico/utils';
import { LocalCommandExecutor } from '@vico/bash';
import type { CommandExecutor } from '@vico/bash';
import { resolvePwshPath } from './resolve-pwsh.js';

/** pwsh 固定启动参数：无 Logo/Profile/交互，命令作为单个 argv 传入，避开 shell 引号层 */
const PWSH_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'];

const pwshParams = z.object({
  command: z.string().describe('The PowerShell command to execute'),
  timeout: z.number().min(1).max(600000).default(120000).describe('Timeout in milliseconds'),
  dryRun: z.boolean().optional().describe('Preview the command without executing it'),
});

/** pwsh 工具的结构化输出 */
const pwshOutput = z.object({
  stdout: z.string().describe('Standard output of the command'),
  stderr: z.string().describe('Standard error of the command'),
  exitCode: z.number().int().nullable().describe('Process exit code, or null if unavailable'),
});
type PwshOutput = z.infer<typeof pwshOutput>;

/**
 * 创建 pwsh 工具。
 *
 * PowerShell 命令不经 POSIX 解析（`parseCommand` 不适用于 pwsh 语法），
 * 直接以 `{ raw, segments: [], cwd, timeout }` 交给执行器派发；执行本身
 * 委托给 {@link @vico/bash} 的 `CommandExecutor`。
 *
 * @param options - 可注入自定义执行器，缺省用 `resolvePwshPath()` 派发 pwsh
 * @returns pwsh 工具
 */
export function createPwshTool(
  { executor = new LocalCommandExecutor({ command: resolvePwshPath(), args: (c) => [...PWSH_ARGS, c] }) }: { executor?: CommandExecutor } = {},
): Tool {
  return createTool({
    name: 'pwsh',
    description:
      'Execute a PowerShell command in the workspace root, primarily for Windows hosts, and return its standard output, standard error and exit code. Supports a timeout (default 120000ms). Set dryRun=true to preview the command without executing it.',
    inputSchema: pwshParams,
    outputSchema: pwshOutput,
    policy: 'auto',
    kind: 'mutation',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof pwshParams>, ctx: ToolCallContext): Promise<PwshOutput> {
      const cwd = resolveWorkspacePath(ctx.session.workspace!, '.');

      if (args.dryRun) {
        return { stdout: `[DRY RUN] Would execute in ${cwd}:\n  ${args.command}`, stderr: '', exitCode: null };
      }

      const result = await executor.execute({ raw: args.command, segments: [], cwd, timeout: args.timeout });

      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    },
  });
}

/** 默认 pwsh 工具单例：以 `resolvePwshPath()` 本地执行器派发命令 */
export const pwshTool: Tool = createPwshTool();
