import { describe, it, expect } from 'vitest';
import { convertTools } from '../tool-converter.js';
import type { ToolDescriptor } from '../types.js';

describe('convertTools', () => {
  it('returns empty array for empty input', () => {
    expect(convertTools([])).toEqual([]);
  });

  it('converts single tool', () => {
    const tools: ToolDescriptor[] = [{
      name: 'search',
      description: 'Search the web',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    }];
    const result = convertTools(tools);
    expect(result).toEqual([{
      type: 'function',
      name: 'search',
      description: 'Search the web',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    }]);
  });

  it('converts multiple tools', () => {
    const tools: ToolDescriptor[] = [
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: {} } },
      { name: 'write', description: 'Write a file', inputSchema: { type: 'object', properties: {} } },
    ];
    const result = convertTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('function');
    expect(result[1].type).toBe('function');
    expect(result[0].name).toBe('read');
    expect(result[1].name).toBe('write');
  });

  it('handles tool without description', () => {
    const tools: ToolDescriptor[] = [{
      name: 'silent',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    }];
    const result = convertTools(tools);
    expect(result[0].description).toBe('');
  });
});
