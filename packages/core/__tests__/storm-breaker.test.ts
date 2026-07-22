// src/__tests__/storm-breaker.test.ts
import { describe, it, expect } from 'vitest';
import { StormBreaker } from '../src/tool/storm-breaker.js';

describe('StormBreaker', () => {
  it('allows first calls', () => {
    const sb = new StormBreaker();
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: false, warning: false });
  });

  it('warns after threshold', () => {
    const sb = new StormBreaker({ warnThreshold: 2, killThreshold: 5 });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: false, warning: true });
  });

  it('blocks after kill threshold', () => {
    const sb = new StormBreaker({ warnThreshold: 2, killThreshold: 3 });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: true, warning: false });
  });

  it('different args are tracked separately', () => {
    const sb = new StormBreaker({ warnThreshold: 1, killThreshold: 2 });
    sb.record('echo', { msg: 'a' });
    sb.record('echo', { msg: 'a' });
    expect(sb.check('echo', { msg: 'b' })).toEqual({ blocked: false, warning: false });
  });

  it('reset clears all records', () => {
    const sb = new StormBreaker({ killThreshold: 2 });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    sb.reset();
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: false, warning: false });
  });
});
