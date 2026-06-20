// agent-loop.test.ts — integration tests for AgentLoop: text-only, tool calls, interrupt
import { describe, it, expect, vi } from 'vitest';
import { AgentLoop, type AgentLoopOptions } from '../agent-loop/agent-loop.js';
import type { ModelClient, ModelStreamChunk, ModelRequest } from '../model/model-client.js';
import type { AgentConfig } from '../contracts/agent.js';
import { MittEventRecorder } from '../observable/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { PromptAssembler } from '../prompt/assembler.js';

function makeConfig(): AgentConfig {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-1',
    name: 'test-agent',
    systemPrompt: 'You are helpful.',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 3,
  };
}

/** 创建一个返回预设 chunks 的 mock ModelClient */
function mockModelClient(chunks: ModelStreamChunk[]): ModelClient {
  return {
    provider: 'mock',
    model: 'mock',
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/** mock ToolHost — 总是返回 success */
const mockToolHost = {
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
      { type: 'text_delta', content: 'Hello!' },
      { type: 'completed', finishReason: 'stop' },
    ]);

    const loop = new AgentLoop({
      config: makeConfig(),
      model,
      toolHost: mockToolHost as any,
      promptAssembler: new PromptAssembler(),
      events,
      spanTracker: tracker,
    });

    const result = await loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'hi' },
      new AbortController().signal,
    );

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(0); // no tool calls, single turn
  });

  it('executes tool calls and continues loop', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const doneEvents: any[] = [];
    events.on('done', (e) => doneEvents.push(e));

    const model = mockModelClient([
      { type: 'text_delta', content: 'Let me search.' },
      { type: 'tool_call_complete', id: 'call-1', name: 'search', args: { q: 'test' } },
      { type: 'completed', finishReason: 'tool_calls' },
      // second model step after tool results
      { type: 'text_delta', content: 'Found results.' },
      { type: 'completed', finishReason: 'stop' },
    ]);

    const loop = new AgentLoop({
      config: makeConfig(),
      model,
      toolHost: mockToolHost as any,
      promptAssembler: new PromptAssembler(),
      events,
      spanTracker: tracker,
    });

    const result = await loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'search for test' },
      new AbortController().signal,
    );

    expect(result.status).toBe('completed');
    expect(result.steps).toBeGreaterThan(0);
    expect(doneEvents.length).toBe(1);

    // verify spans
    const spans = tracker.getAllSpans();
    expect(spans.some((s) => s.type === 'agent_run')).toBe(true);
    expect(spans.some((s) => s.type === 'tool_call')).toBe(true);
  });

  it('interrupts mid-turn', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const controller = new AbortController();

    // model that yields text, then waits for the abort signal (simulates long-running call)
    const model: ModelClient = {
      provider: 'mock',
      model: 'mock',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        yield { type: 'text_delta', content: 'thinking...' };
        // wait until the abort signal fires, simulating a long-running call
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
      },
    };

    const loop = new AgentLoop({
      config: makeConfig(),
      model,
      toolHost: mockToolHost as any,
      promptAssembler: new PromptAssembler(),
      events,
      spanTracker: tracker,
    });

    // interrupt after 10ms — both flag the loop and abort the signal to unblock the stream
    setTimeout(() => {
      loop.interrupt();
      controller.abort();
    }, 10);

    const result = await loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'hi' },
      controller.signal,
    );

    expect(result.status).toBe('interrupted');
  });
});
