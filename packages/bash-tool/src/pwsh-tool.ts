// @vico/bash-tool - PowerShell 持久会话执行工具（面向 Windows）

import {ChildProcess, spawn} from 'node:child_process';
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
  action: z.enum(['run', 'poll', 'write', 'stop']).default('run').describe('Session operation'),
  session_id: z.string().default('default').describe('Session ID used for poll/write/stop operations'),
  input: z.string().optional().describe('Input to send to the session stdin'),
  dryRun: z.boolean().optional().describe('Preview the command without executing it'),
});

interface SessionEntry {
  process: ChildProcess | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  running: boolean;
  createdAt: number;
  /** 防止重复终止 */
  stopped: boolean;
}

/** 全局 pwsh 会话表 */
const sessions = new Map<string, SessionEntry>();

/** 会话超时（10 分钟），超时自动清理 */
const SESSION_TTL = 10 * 60 * 1000;

/** 定期清理过期会话 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
      if (now - entry.createdAt > SESSION_TTL) {
        if (entry.process && entry.running) {
          try { entry.process.kill(); } catch { /* ignore */ }
        }
        sessions.delete(id);
      }
    }
  }, 60000);
}

/**
 * 清理指定的 pwsh 会话。
 */
function cleanupSession(id: string, entry: SessionEntry): void {
  if (entry.process && entry.running && !entry.stopped) {
    entry.stopped = true;
    try { entry.process.kill(); } catch { /* ignore */ }
  }
  sessions.delete(id);
}

async function executePwsh(args: z.infer<typeof pwshParams>, ctx: ToolCallContext): Promise<string> {
  const cwd = resolveWorkspacePath(ctx.session.workspace!, '.');

  switch (args.action) {
    case 'stop':
      return handleStop(args.session_id);
    case 'poll':
      return handlePoll(args.session_id);
    case 'write':
      return handleWrite(args.session_id, args.input);
    default:
      if (args.dryRun) {
        return `[DRY RUN] 将在 ${cwd} 执行:\n  ${args.command}`;
      }
      return handleRun(args.command, args.session_id, args.timeout, cwd);
  }
}

function handleStop(sid: string): string {
  const entry = sessions.get(sid);
  if (!entry) return `会话 "${sid}" 未找到`;
  cleanupSession(sid, entry);
  return `会话 "${sid}" 已停止`;
}

function handlePoll(sid: string): string {
  const entry = sessions.get(sid);
  if (!entry) return `会话 "${sid}" 未找到`;
  if (entry.running) {
    return [
      `会话 "${sid}" 仍在运行中...`,
      entry.stdout ? `\nSTDOUT (最近 2000 字符):\n${entry.stdout.slice(-2000)}` : '',
      entry.stderr ? `\nSTDERR (最近 2000 字符):\n${entry.stderr.slice(-2000)}` : '',
    ].join('\n');
  }
  return [
    `会话 "${sid}" 已完成，退出码: ${entry.exitCode}`,
    entry.stdout ? `\nSTDOUT (最近 4000 字符):\n${entry.stdout.slice(-4000)}` : '',
    entry.stderr ? `\nSTDERR (最近 2000 字符):\n${entry.stderr.slice(-2000)}` : '',
  ].join('\n');
}

function handleWrite(sid: string, input?: string): string {
  const entry = sessions.get(sid);
  if (!entry) return `会话 "${sid}" 未找到`;
  if (!entry.process) return `会话 "${sid}" 没有运行中的进程`;
  if (!input) return '未提供输入';
  try {
    entry.process.stdin?.write(input);
    return `输入已发送到会话 "${sid}"`;
  } catch (err: any) {
    return `发送输入失败: ${err.message}`;
  }
}

function handleRun(command: string, sid: string, timeout: number, cwd: string): Promise<string> {
  ensureCleanupTimer();

  return new Promise<string>((resolveResult) => {
    // 如果同 session_id 已有运行中的会话，先清理旧进程
    const existing = sessions.get(sid);
    if (existing && existing.running && existing.process) {
      try { existing.process.kill(); } catch { /* ignore */ }
    }

    const child = spawn(resolvePwshPath(), [...PWSH_ARGS, command], {
      cwd,
      timeout,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const entry: SessionEntry = {
      process: child,
      stdout: '',
      stderr: '',
      exitCode: null,
      running: true,
      createdAt: Date.now(),
      stopped: false,
    };
    sessions.set(sid, entry);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      entry.stdout = stdout;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      entry.stderr = stderr;
    });

    child.on('close', (code) => {
      entry.running = false;
      entry.exitCode = code;
      entry.process = null;

      if (!settled) {
        settled = true;
        const parts = [`退出码: ${code}`];
        if (stdout) parts.push(`\nSTDOUT:\n${stdout.slice(-4000)}`);
        if (stderr) parts.push(`\nSTDERR:\n${stderr.slice(-2000)}`);
        resolveResult(parts.join(''));
      }
    });

    child.on('error', (err) => {
      entry.running = false;
      entry.process = null;
      entry.exitCode = 1;

      if (!settled) {
        settled = true;
        const parts = [`退出码: 1`, `错误: ${err.message}`];
        if (stdout) parts.push(`\nSTDOUT:\n${stdout.slice(-2000)}`);
        if (stderr) parts.push(`\nSTDERR:\n${stderr.slice(-2000)}`);
        resolveResult(parts.join('\n'));
      }
    });
  });
}

export const pwshTool = createTool({
  name: 'pwsh',
  description:
    'Execute PowerShell commands in a persistent session, primarily for Windows hosts. Supports timeouts and session management for long-running commands (run/poll/write/stop operations). The working directory is the workspace root. Use "run" to start a command, "poll" to check status (incremental output), "write" to send stdin input, and "stop" to terminate the session. Set dryRun=true to preview the command without executing it. Sessions auto-clean up after a 10-minute timeout.',
  inputSchema: pwshParams,
  outputSchema: z.string(),
  policy: 'auto',
  kind: 'mutation',
  tags: ['requires-workspace'],
  execute: executePwsh,
});
