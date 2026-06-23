// agent-loop.test.ts — integration tests for AgentLoop: text-only, tool calls, interrupt
import { describe, it, expect, vi } from 'vitest';
import type { LanguageModel } from 'ai';

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock('ai', () => ({ streamText }));

import { AgentLoop, collectTurnResult } from '../agent-loop/agent-loop.js';
import { Agent } from '../agent-loop/agent.js';
import type { AgentLoopOptions } from '../agent-loop/agent-loop.js';
import type { AgentConfig } from '../agent-loop/types.js';
import { MittEventRecorder } from '../observable/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { SystemPromptProcessor } from '../prompt/system-prompt-processor.js';
import { MemoryStore } from '../memory/memory-store.js';
import { InMemoryThreadStore } from '../thread/memory-thread-store.js';

/** 创建模拟 fullStream 的异步迭代器 */
function mockFullStream(chunks: any[]) {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

/** mock LanguageModel */
const mockLM: LanguageModel = 'mock-model' as unknown as LanguageModel;

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

function makeAgent() {
  return new Agent({
    config: makeConfig(),
    languageModel: mockLM,
    memory: new MemoryStore(),
    thread: new InMemoryThreadStore(),
  });
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
    streamText.mockReturnValue({
      fullStream: mockFullStream([
        { type: 'text-delta', id: '1', text: 'Hello!' },
        { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    });

    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const agent = makeAgent();

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
    streamText.mockReturnValue({
      fullStream: mockFullStream([
        { type: 'text-delta', id: '1', text: 'Let me search.' },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: { q: 'test' } },
        { type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool_calls', totalUsage: { inputTokens: 20, outputTokens: 10 } },
        { type: 'text-delta', id: '2', text: 'Found results.' },
        { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 15, outputTokens: 8 } },
      ]),
    });

    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const doneEvents: any[] = [];
    events.on('done', (e) => doneEvents.push(e));
    const agent = makeAgent();

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
    streamText.mockImplementation(({ abortSignal }: any) => ({
      fullStream: (async function* () {
        yield { type: 'text-delta', id: '1', text: 'thinking...' };
        // 等待 abort 信号
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) { resolve(); return; }
          abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      })(),
    }));

    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const agent = makeAgent();
    const controller = new AbortController();

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
