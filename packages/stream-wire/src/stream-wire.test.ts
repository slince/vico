import {describe, expect, it} from 'vitest';
import type {ChunkType} from '@vico/stream';
import {SESSION_SCOPE_REASON} from '@vico/tool';
import {chunkSSEResponse, toWireChunk} from './chunk-sse.js';
import {resumeToModelMessages, vicoMessagesToModelMessages} from './messages.js';

function chunk(type: ChunkType['type'], payload: unknown): ChunkType {
  return {type, runId: 'run-1', payload} as ChunkType;
}

async function readBody(response: Response): Promise<string> {
  return await response.text();
}

describe('toWireChunk', () => {
  it('剥离任意层级的 providerMetadata', () => {
    const wire = toWireChunk(
      chunk('text-delta', {id: 't1', text: '你好', providerMetadata: {openai: {x: 1}}}),
    );
    expect(wire).toEqual({type: 'text-delta', runId: 'run-1', payload: {id: 't1', text: '你好'}});
  });

  it('嵌套 part 上的 providerMetadata 同样剥离', () => {
    const wire = toWireChunk(
      chunk('tool-result', {
        toolCallId: 'c1',
        toolName: 'x',
        output: {type: 'json', value: {ok: true}, providerMetadata: {p: 1}},
        providerMetadata: {p: 2},
      }),
    );
    expect(JSON.stringify(wire)).not.toContain('providerMetadata');
  });

  it('raw chunk 的 payload 清空', () => {
    const wire = toWireChunk(chunk('raw', {raw: {huge: 'payload'}}));
    expect(wire).toEqual({type: 'raw', runId: 'run-1', payload: {}});
  });

  it('Uint8Array 转为 base64', () => {
    const bytes = new TextEncoder().encode('hi');
    const wire = toWireChunk(chunk('file', {data: bytes, mediaType: 'text/plain'}));
    expect((wire.payload as Record<string, unknown>).data).toBe(btoa('hi'));
  });

  it('产出可 JSON.stringify 的对象', () => {
    const wire = toWireChunk(chunk('finish', {
      finishReason: 'stop',
      totalUsage: {},
      usage: {
        inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0},
        outputTokens: {total: 1, text: 1, reasoning: 0},
      },
    }));
    expect(() => JSON.stringify(wire)).not.toThrow();
  });
});

describe('chunkSSEResponse', () => {
  it('每帧输出 data: <json> 空行结尾，并带上自定义响应头', async () => {
    const chunks = (async function* () {
      yield chunk('text-delta', {id: 't1', text: 'a'});
      yield chunk('text-delta', {id: 't1', text: 'b'});
    })();
    const response = chunkSSEResponse(chunks, {'x-thread-id': 'thread-1'});
    expect(response.headers.get('x-thread-id')).toBe('thread-1');
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const body = await readBody(response);
    const frames = body.trim().split('\n\n').map((line) => line.replace(/^data: /, ''));
    expect(frames.map((f) => JSON.parse(f).payload)).toEqual([
      {id: 't1', text: 'a'},
      {id: 't1', text: 'b'},
    ]);
  });

  it('流中途抛错时下发 error 帧后正常关闭', async () => {
    const chunks = (async function* () {
      yield chunk('start', {turnId: 'turn-1'});
      throw new Error('模型炸了');
    })();
    const body = await readBody(chunkSSEResponse(chunks));
    const frames = body.trim().split('\n\n').map((line) => JSON.parse(line.replace(/^data: /, '')));
    expect(frames.at(-1)).toEqual({type: 'error', runId: 'stream', payload: {error: '模型炸了'}});
  });
});

describe('messages', () => {
  it('前端消息原样进入引擎入参（保留 id）', () => {
    const out = vicoMessagesToModelMessages([
      {id: 'm1', role: 'user', content: [{type: 'text', text: 'hi'}]},
    ]);
    expect(out).toEqual([{id: 'm1', role: 'user', content: [{type: 'text', text: 'hi'}]}]);
  });

  it('审批决议转为 tool-approval-response，session 范围打标', () => {
    const out = resumeToModelMessages([
      {approvalId: 'c1', approved: true},
      {approvalId: 'c2', approved: false, reason: '不行', scope: 'session'},
    ]);
    const content = out[0]?.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({type: 'tool-approval-response', approvalId: 'c1', approved: true});
    expect(content[1]).toMatchObject({type: 'tool-approval-response', approvalId: 'c2', approved: false});
    // scope=session 时 reason 被替换为引擎约定的会话级标记（原 reason 让位给升级语义）
    expect(content[1]?.reason).toBe(SESSION_SCOPE_REASON);
  });
});
