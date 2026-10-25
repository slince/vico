import { describe, it, expect } from 'vitest';
import { LocalCommandExecutor } from './local-executor.js';

const bash = new LocalCommandExecutor({ command: '/bin/bash', args: (c) => ['-c', c] });

describe('LocalCommandExecutor', () => {
  it('echo 返回 stdout 与 exitCode 0', async () => {
    const r = await bash.execute({ raw: 'echo hello', segments: [], timeout: 5000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hello\n');
  });

  it('非零退出码透传', async () => {
    const r = await bash.execute({ raw: 'exit 3', segments: [], timeout: 5000 });
    expect(r.exitCode).toBe(3);
  });

  it('超时返回 exitCode null + timedOut true', async () => {
    const r = await bash.execute({ raw: 'sleep 2', segments: [], timeout: 100 });
    expect(r.exitCode).toBeNull();
    expect(r.timedOut).toBe(true);
  });
});
