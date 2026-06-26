// agent-loop.test.ts — integration tests for AgentLoop: text-only, tool calls, interrupt
import { describe, it, expect, vi } from 'vitest';
import type { LanguageModelV3, LanguageModelV3StreamResult } from '@ai-sdk/provider';

import { AgentLoop, collectTurnResult } from '../agent-loop/agent-loop.js';
import { Agent } from '../agent-loop/agent.js';
import type { AgentConfig, TurnEvent } from '../agent-loop/types.js';
import { MittEventRecorder } from '../events/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { SystemPromptProcessor } from '../prompt/system-prompt-processor.js';
import { MemoryStore } from '../memory/memory-store.js';
import { InMemoryThreadStore } from '../thread/memory-thread-store.js';

/** Create a mock LanguageModelV3 whose doStream yields given stream parts */
function createMockModel(chunks: any[]): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
    doStream: vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
    } satisfies LanguageModelV3StreamResult),
  };
}

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

function makeAgent(chunks: any[]) {
  return new Agent({
    config: makeConfig(),
    model: createMockModel(chunks),
    memory: new MemoryStore(),
    thread: new InMemoryThreadStore(),
  });
}

/** mock ToolBroker — 总是返回 success */
const mockToolBroker = {
  findTool: (_name: string) => ({ policy: 'auto' }),
  listTools: async () => [],
  execute: async (call: any) => ({ callId: call.id, name: call.name, status: 'success' as const, output: 'ok' }),
  executeBatch: async (calls: any[]) =>
    calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, output: 'ok' })),
};

describe('AgentLoop', () => {
  it('completes a turn with text-only response', async () => {
    const events = new MittEventRecorder<TurnEvent>();
    const tracker = new InMemorySpanTracker();
    const agent = makeAgent([
      { type: 'text-start', id: '1' },
      { type: 'text-delta', id: '1', delta: 'Hello!' },
      { type: 'text-end', id: '1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } },
    ]);

    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      events,
      spanTracker: tracker,
    });

    const result = await collectTurnResult(loop.runTurn(
      'thread-1',
      { role: 'user', content: 'hi' },
    ));

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(0);
  });

  it('executes tool calls and continues loop', async () => {
    // doStream is called twice: first for the initial response, then again with tool results
    let callCount = 0;
    const makeStream = () => new ReadableStream({
      start(controller) {
        if (callCount === 0) {
          controller.enqueue({ type: 'text-start', id: '1' });
          controller.enqueue({ type: 'text-delta', id: '1', delta: 'Let me search.' });
          controller.enqueue({ type: 'text-end', id: '1' });
          controller.enqueue({ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: JSON.stringify({ q: 'test' }) });
          controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: { inputTokens: { total: 20 }, outputTokens: { total: 10 } } });
        } else {
          controller.enqueue({ type: 'text-start', id: '2' });
          controller.enqueue({ type: 'text-delta', id: '2', delta: 'Found results.' });
          controller.enqueue({ type: 'text-end', id: '2' });
          controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 15 }, outputTokens: { total: 8 } } });
        }
        callCount++;
        controller.close();
      },
    });

    const mockModel: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'mock-model',
      supportedUrls: {},
      doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
      doStream: vi.fn().mockImplementation(() => Promise.resolve({
        stream: makeStream(),
      } satisfies LanguageModelV3StreamResult)),
    };

    const events = new MittEventRecorder<TurnEvent>();
    const tracker = new InMemorySpanTracker();
    const doneEvents: any[] = [];
    events.on('done', (e) => doneEvents.push(e));
    const agent = new Agent({
      config: makeConfig(),
      model: mockModel,
      memory: new MemoryStore(),
      thread: new InMemoryThreadStore(),
    });

    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      events,
      spanTracker: tracker,
    });

    const result = await collectTurnResult(loop.runTurn(
      'thread-1',
      { role: 'user', content: 'search for test' },
    ));

    expect(result.status).toBe('completed');
    expect(result.steps).toBeGreaterThan(0);
    expect(doneEvents.length).toBe(1);

    const spans = tracker.getAllSpans();
    expect(spans.some((s) => s.type === 'agent_run')).toBe(true);
    expect(spans.some((s) => s.type === 'tool_call')).toBe(true);
  });

  it('interrupts mid-turn', async () => {
    const mockModel: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'mock-model',
      supportedUrls: {},
      doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
      doStream: vi.fn().mockImplementation(async ({ abortSignal }: any) => ({
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: 'text-start', id: '1' });
            controller.enqueue({ type: 'text-delta', id: '1', delta: 'thinking...' });
            // Wait for abort
            await new Promise<void>((resolve) => {
              if (abortSignal?.aborted) { resolve(); return; }
              abortSignal?.addEventListener('abort', () => resolve(), { once: true });
            });
            controller.enqueue({ type: 'text-end', id: '1' });
            controller.close();
          },
        }),
      } satisfies LanguageModelV3StreamResult)),
    };

    const events = new MittEventRecorder<TurnEvent>();
    const tracker = new InMemorySpanTracker();
    const agent = new Agent({
      config: makeConfig(),
      model: mockModel,
      memory: new MemoryStore(),
      thread: new InMemoryThreadStore(),
    });
    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      events,
      spanTracker: tracker,
    });

    const output = loop.runTurn('thread-1', { role: 'user', content: 'hi' });
    setTimeout(() => output.abort(), 10);

    const result = await collectTurnResult(output);

    expect(result.status).toBe('interrupted');
  });
});
