// @vico/bash-tool - PowerShell 命令执行工具（面向 Windows）

import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {z} from 'zod';
import {createTool} from '@vico/tool';
import {resolveWorkspacePath} from '@vico/utils';
import type {ToolCallContext} from '@vico/tool';
import {resolvePwshPath} from './resolve-pwsh.js';

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

async function executePwsh(args: z.infer<typeof pwshParams>, ctx: ToolCallContext): Promise<PwshOutput> {
  const cwd = resolveWorkspacePath(ctx.session.workspace!, '.');

  if (args.dryRun) {
    return { stdout: `[DRY RUN] Would execute in ${cwd}:\n  ${args.command}`, stderr: '', exitCode: null };
  }

  return runCommand(args.command, args.timeout, cwd);
}

/**
 * 直接执行一条 PowerShell 命令，收集 stdout/stderr 并在进程结束时返回。
 */
async function runCommand(command: string, timeout: number, cwd: string): Promise<PwshOutput> {
  const child = spawn(resolvePwshPath(), [...PWSH_ARGS, command], {
    cwd,
    timeout,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  try {
    const [code] = await once(child, 'close');
    return { stdout, stderr, exitCode: code };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout,
      stderr: stderr ? `${stderr}\nError: ${message}` : `Error: ${message}`,
      exitCode: 1,
    };
  }
}

export const pwshTool = createTool({
  name: 'pwsh',
  description:
    'Execute a PowerShell command in the workspace root, primarily for Windows hosts, and return its standard output, standard error and exit code. Supports a timeout (default 120000ms). Set dryRun=true to preview the command without executing it.',
  inputSchema: pwshParams,
  outputSchema: pwshOutput,
  policy: 'auto',
  kind: 'mutation',
  tags: ['requires-workspace'],
  execute: executePwsh,
});
