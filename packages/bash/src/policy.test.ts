import { describe, it, expect, vi } from 'vitest';
import { parseCommand } from './parse.js';
import { analyzeCommand } from './analyze.js';
import { permissivePolicy, withPolicy } from './policy.js';
import type { Command, CommandResult } from './command.js';
import type { CommandAnalysis } from './analyze.js';

const okResult: CommandResult = { stdout: 'x', stderr: '', exitCode: 0, durationMs: 1 };

describe('withPolicy', () => {
  it('permissivePolicy 放行', async () => {
    const cmd = parseCommand('ls');
    const d = await permissivePolicy.evaluate(cmd, analyzeCommand(cmd));
    expect(d).toEqual({ allow: true });
  });

  it('block 时不调用内层执行器，返回 blocked 结果', async () => {
    const inner = { execute: vi.fn().mockResolvedValue(okResult) };
    const policy = { evaluate: () => ({ allow: false, reason: 'no rm' }) };
    const r = await withPolicy(inner, policy).execute(parseCommand('rm -rf /x'));
    expect(inner.execute).not.toHaveBeenCalled();
    expect(r).toMatchObject({ blocked: true, blockReason: 'no rm', stdout: '', exitCode: null, durationMs: 0 });
    expect(r.stderr).toBe('Blocked by policy: no rm');
  });

  it('allow 时透传内层结果，并把 analysis 交给 policy', async () => {
    const inner = { execute: vi.fn().mockResolvedValue(okResult) };
    let received: CommandAnalysis | undefined;
    const policy = { evaluate: (_cmd: Command, analysis: CommandAnalysis) => { received = analysis; return { allow: true }; } };
    const r = await withPolicy(inner, policy).execute(parseCommand('rm -rf /www/xxx'));
    expect(r).toBe(okResult);
    expect(received?.segments[0].category).toBe('delete');
  });
});
