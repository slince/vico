// src/__tests__/token-economy.test.ts
import { describe, it, expect } from 'vitest';
import { TokenEconomy } from '../src/agent-loop/token-economy.js';

describe('TokenEconomy', () => {
  it('tracks usage', () => {
    const te = new TokenEconomy();
    te.track(100, 50);
    expect(te.getUsage()).toEqual({ input: 100, output: 50 });
  });

  it('detects input exhaustion', () => {
    const te = new TokenEconomy(100, 100);
    te.track(101, 0);
    expect(te.isInputExhausted()).toBe(true);
  });

  it('detects output exhaustion', () => {
    const te = new TokenEconomy(100, 100);
    te.track(0, 101);
    expect(te.isOutputExhausted()).toBe(true);
  });

  it('truncates tool output', () => {
    const te = new TokenEconomy(1000, 1000, 10);
    const result = te.truncateToolOutput('a'.repeat(50));
    expect(result).toHaveLength(10 + '... [truncated]'.length);
    expect(result).toContain('... [truncated]');
  });

  it('does not truncate short output', () => {
    const te = new TokenEconomy(1000, 1000, 100);
    const result = te.truncateToolOutput('short');
    expect(result).toBe('short');
  });

  it('resets all counters', () => {
    const te = new TokenEconomy();
    te.track(100, 50);
    te.reset();
    expect(te.getUsage()).toEqual({ input: 0, output: 0 });
    expect(te.isInputExhausted()).toBe(false);
  });
});
