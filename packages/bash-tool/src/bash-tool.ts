// @vico/bash-tool - Bash 命令执行工具
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {z} from 'zod';
import type {ToolCallContext} from '@vico/tool';
import {createTool} from '@vico/tool';
import {resolveWorkspacePath} from '@vico/utils';

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

async function executeBash(args: z.infer<typeof bashParams>, ctx: ToolCallContext): Promise<BashOutput> {
  const cwd = resolveWorkspacePath(ctx.session.workspace!, '.');

  if (args.dryRun) {
    return { stdout: `[DRY RUN] Would execute in ${cwd}:\n  ${args.command}`, stderr: '', exitCode: null };
  }

  return runCommand(args.command, args.timeout, cwd);
}

/**
 * 直接执行一条命令，收集 stdout/stderr 并在进程结束时返回。
 */
async function runCommand(command: string, timeout: number, cwd: string): Promise<BashOutput> {
  const child = spawn('/bin/bash', ['-c', command], {
    cwd,
    timeout,
    env: { ...process.env, HOME: process.env.HOME ?? '/root' },
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

export const bashTool = createTool({
  name: 'bash',
  description:
    'Execute a shell command in the workspace root and return its standard output, standard error and exit code. Supports a timeout (default 120000ms). Set dryRun=true to preview the command without executing it.',
  inputSchema: bashParams,
  outputSchema: bashOutput,
  policy: 'auto',
  kind: 'mutation',
  tags: ['requires-workspace'],
  execute: executeBash,
});
