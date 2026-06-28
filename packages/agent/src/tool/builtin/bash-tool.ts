// src/tool/builtin/bash-tool.ts
import {ChildProcess, exec} from 'node:child_process';
import {resolve} from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const bashParams = z.object({
  command: z.string().describe('要执行的 shell 命令'),
  timeout: z.number().min(1).max(600000).default(120000).describe('超时时间（毫秒）'),
  action: z.enum(['run', 'poll', 'write', 'stop']).default('run').describe('会话操作'),
  session_id: z.string().default('default').describe('用于 poll/write/stop 操作的会话 ID'),
  input: z.string().optional().describe('发送到会话 stdin 的输入'),
});

interface SessionEntry {
  process: ChildProcess | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  running: boolean;
  createdAt: number;
}

/** 全局 Bash 会话表 */
const sessions = new Map<string, SessionEntry>();

/**
 * 清理指定的 Bash 会话。
 *
 * 终止会话对应的子进程（如果仍在运行），并从会话表中移除记录。
 *
 * @param id - 会话 ID
 * @param entry - 会话条目，包含进程引用等信息
 */
function cleanupSession(id: string, entry: SessionEntry): void {
  if (entry.process) {
    try { entry.process.kill(); } catch { /* ignore */ }
  }
  sessions.delete(id);
}

async function executeBash(call: ToolCall, ctx: ToolExecutionContext): Promise<string> {
  const args = call.args as unknown as z.infer<typeof bashParams>;
  const cwd = resolve(ctx.session.workspace, '.');

  switch (args.action) {
    case 'stop':
      return handleStop(args.session_id);
    case 'poll':
      return handlePoll(args.session_id);
    case 'write':
      return handleWrite(args.session_id, args.input);
    default:
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
    return `会话 "${sid}" 仍在运行...\n\nSTDOUT:\n${entry.stdout.slice(-2000)}\n\nSTDERR:\n${entry.stderr.slice(-2000) || '(无)'}`;
  }
  return [
    `会话 "${sid}" 已完成，退出码 ${entry.exitCode}`,
    entry.stdout ? `\nSTDOUT:\n${entry.stdout.slice(-4000)}` : '',
    entry.stderr ? `\nSTDERR:\n${entry.stderr.slice(-2000)}` : '',
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
  return new Promise<string>((resolveResult) => {
    const child = exec(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
      env: { ...process.env, HOME: process.env.HOME ?? '/root' },
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
    };
    sessions.set(sid, entry);

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      entry.stdout = stdout;
    });

    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      entry.stderr = stderr;
    });

    child.on('close', (code) => {
      entry.running = false;
      entry.exitCode = code;
      entry.process = null;

      if (!settled) {
        settled = true;
        const output = [
          `命令已完成，退出码 ${code}`,
          stdout ? `\nSTDOUT:\n${stdout.slice(-4000)}` : '',
          stderr ? `\nSTDERR:\n${stderr.slice(-2000)}` : '',
        ].join('\n');
        resolveResult(output);
      }
    });

    child.on('error', (err) => {
      entry.running = false;
      entry.process = null;
      entry.exitCode = 1;

      if (!settled) {
        settled = true;
        resolveResult(`命令失败: ${err.message}\n\nSTDOUT:\n${stdout.slice(-2000)}\n\nSTDERR:\n${stderr.slice(-2000)}`);
      }
    });
  });
}

export const bashTool = createTool({
  name: 'bash',
  description:
    '在持久会话中执行 shell 命令。支持长运行命令的超时和会话管理（run/poll/write/stop 操作）。工作目录为工作区根目录。使用 "run" 启动命令，"poll" 检查状态，"write" 发送输入，"stop" 终止。',
  inputSchema: bashParams,
  outputSchema: z.string(),
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'command'],
  execute: executeBash,
});
