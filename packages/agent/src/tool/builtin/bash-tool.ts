// src/tool/builtin/bash-tool.ts
import {ChildProcess, exec} from 'node:child_process';
import {resolve} from 'node:path';
import type {Tool} from '../types.js';

interface BashArgs {
  command: string;
  timeout?: number;
  action?: 'run' | 'poll' | 'write' | 'stop';
  session_id?: string;
  input?: string;
}

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

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Execute a shell command in a persistent session. Supports long-running commands with timeout and session management (run/poll/write/stop actions). The working directory is the workspace root. Use "run" to start a command, "poll" to check status, "write" to send input, and "stop" to terminate.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000, max: 600000)' },
      action: { type: 'string', enum: ['run', 'poll', 'write', 'stop'], description: 'Session action (default: run)' },
      session_id: { type: 'string', description: 'Session ID for poll/write/stop actions' },
      input: { type: 'string', description: 'Input to send to the session stdin (for write action)' },
    },
    required: ['command'],
  },
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'command'],
  async execute(call, ctx) {
    const args = call.args as unknown as BashArgs;
    const action = args.action ?? 'run';
    const timeout = Math.min(args.timeout ?? 120000, 600000);
    const cwd = resolve(ctx.session.workspace, '.');

    // ---- stop ----
    if (action === 'stop') {
      const sid = args.session_id ?? 'default';
      const entry = sessions.get(sid);
      if (!entry) return `Session "${sid}" not found`;
      cleanupSession(sid, entry);
      return `Session "${sid}" stopped`;
    }

    // ---- poll ----
    if (action === 'poll') {
      const sid = args.session_id ?? 'default';
      const entry = sessions.get(sid);
      if (!entry) return `Session "${sid}" not found`;
      if (entry.running) return `Session "${sid}" still running...\n\nSTDOUT:\n${entry.stdout.slice(-2000)}\n\nSTDERR:\n${entry.stderr.slice(-2000) || '(none)'}`;

      return [
        `Session "${sid}" completed with exit code ${entry.exitCode}`,
        entry.stdout ? `\nSTDOUT:\n${entry.stdout.slice(-4000)}` : '',
        entry.stderr ? `\nSTDERR:\n${entry.stderr.slice(-2000)}` : '',
      ].join('\n');
    }

    // ---- write ----
    if (action === 'write') {
      const sid = args.session_id ?? 'default';
      const entry = sessions.get(sid);
      if (!entry) return `Session "${sid}" not found`;
      if (!entry.process) return `Session "${sid}" has no running process`;
      if (!args.input) return 'No input provided';
      try {
        entry.process.stdin?.write(args.input);
        return `Input sent to session "${sid}"`;
      } catch (err: any) {
        return `Failed to send input: ${err.message}`;
      }
    }

    // ---- run (default) ----
    if (!args.command || typeof args.command !== 'string') {
      throw new Error('"command" is required and must be a string');
    }

    const sid = args.session_id ?? 'default';

    return new Promise<string>((resolveResult) => {
      const child = exec(args.command, {
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
  },
};
