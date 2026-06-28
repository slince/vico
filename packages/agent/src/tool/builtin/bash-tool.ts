// src/tool/builtin/bash-tool.ts
import {ChildProcess, exec, spawn} from 'node:child_process';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolExecutionContext} from '../types.js';
import {resolveWorkspacePath} from './workspace.js';

const bashParams = z.object({
  command: z.string().describe('要执行的 shell 命令'),
  timeout: z.number().min(1).max(600000).default(120000).describe('超时时间（毫秒）'),
  action: z.enum(['run', 'poll', 'write', 'stop']).default('run').describe('会话操作'),
  session_id: z.string().default('default').describe('用于 poll/write/stop 操作的会话 ID'),
  input: z.string().optional().describe('发送到会话 stdin 的输入'),
  dryRun: z.boolean().optional().describe('仅预览命令而不实际执行'),
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

/** 全局 Bash 会话表 */
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
 * 清理指定的 Bash 会话。
 */
function cleanupSession(id: string, entry: SessionEntry): void {
  if (entry.process && entry.running && !entry.stopped) {
    entry.stopped = true;
    try { entry.process.kill(); } catch { /* ignore */ }
  }
  sessions.delete(id);
}

async function executeBash(args: z.infer<typeof bashParams>, ctx: ToolExecutionContext): Promise<string> {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');

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

    const child = spawn('/bin/bash', ['-c', command], {
      cwd,
      timeout,
      env: { ...process.env, HOME: process.env.HOME ?? '/root' },
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

export const bashTool = createTool({
  name: 'bash',
  description:
    '在持久会话中执行 shell 命令。支持长运行命令的超时和会话管理（run/poll/write/stop 操作）。工作目录为工作区根目录。使用 "run" 启动命令，"poll" 检查状态（增量输出），"write" 发送 stdin 输入，"stop" 终止会话。dryRun=true 可预览命令而不执行。会话超时 10 分钟自动清理。',
  inputSchema: bashParams,
  outputSchema: z.string(),
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'command'],
  execute: executeBash,
});
