import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  BLOCK_OVERHEAD, CHARS_PER_TOKEN, ROLE_OVERHEAD,
  estimateContent, estimateMessage, measure,
} from './token-estimator.js';

describe('token-estimator', () => {
  it('纯文本 string content 按 chars/4 + block 开销计', () => {
    // "hello" = 5 chars → ceil(5/4)=2 + BLOCK_OVERHEAD
    expect(estimateContent('hello')).toBe(2 + BLOCK_OVERHEAD);
  });

  it('parts 数组逐 block 分派：text/reasoning/tool-call/未知', () => {
    const content: ModelMessage['content'] = [
      { type: 'text', text: 'hello' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: '/a/b' } },
      { type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: { type: 'text', value: 'ok' } },
    ];
    const text = Math.ceil(5 / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
    const reasoning = Math.ceil(8 / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
    const toolCall = Math.ceil(4 / CHARS_PER_TOKEN) + Math.ceil(JSON.stringify({ path: '/a/b' }).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
    const toolResult = BLOCK_OVERHEAD + Math.ceil(JSON.stringify(content[3]).length / CHARS_PER_TOKEN);
    expect(estimateContent(content)).toBe(text + reasoning + toolCall + toolResult);
  });

  it('estimateMessage 对非 system 加 ROLE_OVERHEAD', () => {
    expect(estimateMessage({ role: 'user', content: 'hello' })).toBe(estimateContent('hello') + ROLE_OVERHEAD);
  });

  it('estimateMessage 对 system 走纯文本密度 + ROLE_OVERHEAD（无 per-block）', () => {
    const msg: ModelMessage = { role: 'system', content: [{ type: 'text', text: 'sys' }] };
    // system：直接对文本长度估，不加 block 开销
    expect(estimateMessage(msg)).toBe(Math.ceil(3 / CHARS_PER_TOKEN) + ROLE_OVERHEAD);
  });

  it('measure 无 anchor 时 totalTokens = surfaceTokens', () => {
    const m = measure([{ role: 'user', content: 'hello' }]);
    expect(m.totalTokens).toBe(m.surfaceTokens);
    expect(m.nodes).toHaveLength(1);
    expect(m.nodes[0].tokens).toBe(m.nodes[0].heuristicTokens); // v1 route = heuristic
  });

  it('measure 有 anchor 时 totalTokens = max(0, pressure + surface - sampled)', () => {
    const m = measure(
      [{ role: 'user', content: 'hello' }],
      { pressureTokens: 1000, sampledSurfaceTokens: 800 },
    );
    expect(m.totalTokens).toBe(1000 + m.surfaceTokens - 800);
  });

  it('measure anchor 使投影为负时取 0', () => {
    const m = measure(
      [{ role: 'user', content: 'hello' }],
      { pressureTokens: 10, sampledSurfaceTokens: 800 },
    );
    expect(m.totalTokens).toBe(0);
  });
});
