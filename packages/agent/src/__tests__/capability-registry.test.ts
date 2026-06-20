// src/__tests__/capability-registry.test.ts
import { describe, it, expect } from 'vitest';
import { CapabilityRegistry } from '../tool/capability-registry.js';

const mockTool = (name: string) => ({ name, description: '', inputSchema: {}, policy: 'auto' as const, kind: 'readonly' as const });

describe('CapabilityRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), ['read']);
    expect(reg.get('a')).toBeDefined();
    expect(reg.get('b')).toBeUndefined();
  });

  it('filters by allowed names', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), []);
    reg.register(mockTool('b'), []);
    reg.register(mockTool('c'), []);
    const filtered = reg.filter(['a', 'c']);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('filters by capabilities', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), ['read']);
    reg.register(mockTool('b'), ['write']);
    reg.register(mockTool('c'), ['read', 'write']);
    const filtered = reg.filter(undefined, ['read']);
    expect(filtered.map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('combines name + capability filters', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), ['read']);
    reg.register(mockTool('b'), ['read']);
    reg.register(mockTool('c'), ['write']);
    const filtered = reg.filter(['a', 'c'], ['read']);
    expect(filtered.map((t) => t.name)).toEqual(['a']);
  });

  it('unregister removes tool', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), []);
    reg.unregister('a');
    expect(reg.get('a')).toBeUndefined();
  });
});
