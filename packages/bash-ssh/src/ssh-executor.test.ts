import { describe, it, expect } from 'vitest';
import { parseCommand } from '@vico/bash';
import { buildRemoteCommand } from './ssh-executor.js';

describe('buildRemoteCommand', () => {
  it('拼接 env + cd + raw', () => {
    const cmd = parseCommand('ls -la', { cwd: '/www', env: { FOO: 'bar' } });
    expect(buildRemoteCommand(cmd)).toBe("export FOO=bar; cd /www && ls -la");
  });
  it('无 cwd/env 时只输出 raw', () => {
    expect(buildRemoteCommand(parseCommand('pwd'))).toBe('pwd');
  });
});
