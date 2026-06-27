// src/tool/builtin/bash-tool.ts
import {ChildProcess, exec} from 'node:child_process';
import {resolve} from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const bashParams = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z.number().min(1).max(600000).default(120000).describe('Timeout in milliseconds'),
  action: z.enum(['run', 'poll', 'write', 'stop']).default('run').describe('Session action'),
  session_id: z.string().default('default').describe('Session ID for poll/write/stop actions'),
  input: z.string().optional().describe('Input to send to the session stdin'),
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

/** 清理超时会话 */
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
  if (!entry) return `Session "${sid}" not found`;
  cleanupSession(sid, entry);
  return `Session "${sid}" stopped`;
}

function handlePoll(sid: string): string {
  const entry = sessions.get(sid);
  if (!entry) return `Session "${sid}" not found`;
  if (entry.running) {
    return `Session "${sid}" still running...\n\nSTDOUT:\n${entry.stdout.slice(-2000)}\n\nSTDERR:\n${entry.stderr.slice(-2000) || '(none)'}`;
  }
  return [
    `Session "${sid}" completed with exit code ${entry.exitCode}`,
    entry.stdout ? `\nSTDOUT:\n${entry.stdout.slice(-4000)}` : '',
    entry.stderr ? `\nSTDERR:\n${entry.stderr.slice(-2000)}` : '',
  ].join('\n');
}

function handleWrite(sid: string, input?: string): string {
  const entry = sessions.get(sid);
  if (!entry) return `Session "${sid}" not found`;
  if (!entry.process) return `Session "${sid}" has no running process`;
  if (!input) return 'No input provided';
  try {
    entry.process.stdin?.write(input);
    return `Input sent to session "${sid}"`;
  } catch (err: any) {
    return `Failed to send input: ${err.message}`;
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
          `Command completed with exit code ${code}`,
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
        resolveResult(`Command failed: ${err.message}\n\nSTDOUT:\n${stdout.slice(-2000)}\n\nSTDERR:\n${stderr.slice(-2000)}`);
      }
    });
  });
}

export const bashTool = createTool({
  name: 'bash',
  description:
    'Execute a shell command in a persistent session. Supports long-running commands with timeout and session management (run/poll/write/stop actions). The working directory is the workspace root. Use "run" to start a command, "poll" to check status, "write" to send input, and "stop" to terminate.',
  inputSchema: bashParams,
  outputSchema: z.string(),
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'command'],
  execute: executeBash,
});
