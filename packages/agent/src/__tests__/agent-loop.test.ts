// agent-loop.test.ts — integration tests for AgentLoop: text-only, tool calls, interrupt
import { describe, it, expect, vi } from 'vitest';
import { AgentLoop, collectTurnResult } from '../agent-loop/agent-loop.js';
import { Agent, type AgentLoopOptions } from '../agent-loop/types.js';
import type { ModelClient, ModelStreamChunk, ModelRequest } from '../model/types.js';
import type { AsyncIterableStream } from 'ai';
import type { AgentConfig } from '../agent-loop/types.js';
import { MittEventRecorder } from '../observable/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { SystemPromptProcessor } from '../prompt/system-prompt-processor.js';
import { MemoryStore } from '../memory/memory-store.js';
import { InMemoryThreadStore } from '../thread/memory-thread-store.js';

function makeConfig(): AgentConfig {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test-agent',
    systemPrompt: 'You are helpful.',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 3,
  };
}

function makeAgent(model: ModelClient) {
  return new Agent({
    config: makeConfig(),
    model,
    memory: new MemoryStore(),
    thread: new InMemoryThreadStore(),
  });
}

/** 创建一个返回预设 chunks 的 mock ModelClient */
function mockModelClient(chunks: ModelStreamChunk[]): ModelClient {
  return {
    provider: 'mock',
    model: 'mock',
    stream(_request: ModelRequest): AsyncIterableStream<ModelStreamChunk> {
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })() as unknown as AsyncIterableStream<ModelStreamChunk>;
    },
  };
}

/** mock ToolBroker — 总是返回 success */
const mockToolBroker = {
  listTools: async () => [],
  execute: async (call: any) => ({ callId: call.id, name: call.name, status: 'success' as const, output: 'ok' }),
  executeBatch: async (calls: any[]) =>
    calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, output: 'ok' })),
};

describe('AgentLoop', () => {
  it('completes a turn with text-only response', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();

    const model = mockModelClient([
      { type: 'text-delta', id: '1', text: 'Hello!' } as ModelStreamChunk,
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 10, outputTokens: 5 } } as ModelStreamChunk,
    ]);

    const agent = makeAgent(model);

    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      events,
      spanTracker: tracker,
    });

    const result = await collectTurnResult(loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'hi' },
      new AbortController().signal,
    ));

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(0);
  });

  it('executes tool calls and continues loop', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const doneEvents: any[] = [];
    events.on('done', (e) => doneEvents.push(e));

    const model = mockModelClient([
      { type: 'text-delta', id: '1', text: 'Let me search.' } as ModelStreamChunk,
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: { q: 'test' } } as ModelStreamChunk,
      { type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool_calls', totalUsage: { inputTokens: 20, outputTokens: 10 } } as ModelStreamChunk,
      { type: 'text-delta', id: '2', text: 'Found results.' } as ModelStreamChunk,
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 15, outputTokens: 8 } } as ModelStreamChunk,
    ]);

    const agent = makeAgent(model);

    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      events,
      spanTracker: tracker,
    });

    const result = await collectTurnResult(loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'search for test' },
      new AbortController().signal,
    ));

    expect(result.status).toBe('completed');
    expect(result.steps).toBeGreaterThan(0);
    expect(doneEvents.length).toBe(1);

    const spans = tracker.getAllSpans();
    expect(spans.some((s) => s.type === 'agent_run')).toBe(true);
    expect(spans.some((s) => s.type === 'tool_call')).toBe(true);
  });

  it('interrupts mid-turn', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const controller = new AbortController();

    const model: ModelClient = {
      provider: 'mock',
      model: 'mock',
      stream(request: ModelRequest): AsyncIterableStream<ModelStreamChunk> {
        return (async function* () {
          yield { type: 'text-delta' as const, id: '1', text: 'thinking...' } as ModelStreamChunk;
          await new Promise<void>((resolve) => {
            if (request.abortSignal.aborted) {
              resolve();
              return;
            }
            const onAbort = () => {
              request.abortSignal.removeEventListener('abort', onAbort);
              resolve();
            };
            request.abortSignal.addEventListener('abort', onAbort);
          });
        })() as unknown as AsyncIterableStream<ModelStreamChunk>;
      },
    };

    const agent = makeAgent(model);

    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      events,
      spanTracker: tracker,
    });

    setTimeout(() => {
      loop.interrupt();
      controller.abort();
    }, 10);

    const result = await collectTurnResult(loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'hi' },
      controller.signal,
    ));

    expect(result.status).toBe('interrupted');
  });
});
