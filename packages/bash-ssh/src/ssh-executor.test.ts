import { describe, it, expect } from 'vitest';
import { parseCommand } from '@vico/bash';
import { buildRemoteCommand } from './ssh-executor.js';

describe('buildRemoteCommand', () => {
  it('拼接 env + cd + raw（env 值与 cwd 单引号包裹）', () => {
    const cmd = parseCommand('ls -la', { cwd: '/www', env: { FOO: 'bar' } });
    expect(buildRemoteCommand(cmd)).toBe("export FOO='bar'; cd '/www' && ls -la");
  });
  it('无 cwd/env 时只输出 raw', () => {
    expect(buildRemoteCommand(parseCommand('pwd'))).toBe('pwd');
  });
  it('env 值含单引号按 shell 惯用法转义', () => {
    const cmd = parseCommand('pwd', { env: { GREETING: "O'Brien" } });
    expect(buildRemoteCommand(cmd)).toBe("export GREETING='O'\\''Brien'; pwd");
  });
});
