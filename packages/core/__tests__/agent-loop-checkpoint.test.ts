// agent-loop-checkpoint.test.ts — AgentLoop checkpoint integration tests
import { describe, expect, it, vi } from 'vitest';
import type { LanguageModelV4, LanguageModelV4StreamResult } from '@ai-sdk/provider';
import { AgentLoop } from '../src/agent/agent-loop.js';
import { Agent } from '../src/agent/agent.js';
import type { TurnEvent } from '../src/agent/types.js';
import { MittEventRecorder } from '../src/events/event-recorder.js';
import { TurnTracer } from '../src/observable/turn-tracer.js';
import { SystemPromptProcessor } from '../src/agent/context-processors/system-prompt-processor.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { InMemoryThreadStore } from '../src/thread/memory-thread-store.js';
import { collectTurnResult } from '../src/agent/utils.js';
import { MemoryCheckpointStore } from '../src/agent/memory-checkpoint-store.js';
import type { CheckpointStore } from '../src/agent/checkpoint.js';
import type { Tool } from '../src/tool/types.js';
import { z } from 'zod';

/** Create a mock LanguageModelV4 whose doStream yields given stream parts */
function createMockModel(chunks: any[]): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
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
    } satisfies LanguageModelV4StreamResult),
  };
}

/** Mock tool registered on the agent so ToolBroker can resolve tool calls */
const mockSearchTool: Tool = {
  name: 'search',
  description: 'Search tool',
  inputSchema: z.object({}),
  policy: 'auto',
  kind: 'readonly',
  tags: [],
  execute: async () => 'ok',
};

function makeAgent(chunks: any[], checkpointStore?: CheckpointStore) {
  const events = new MittEventRecorder<TurnEvent>();
  return new Agent({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test-agent',
    systemPrompt: 'You are helpful.',
    model: createMockModel(chunks),
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 3,
    memory: new MemoryStore(),
    thread: new InMemoryThreadStore(),
    events,
    tracer: new TurnTracer(events, []),
    tools: [mockSearchTool],
    skills: [],
    approvalResolver: () => ({ approved: true }),
    checkpointStore: checkpointStore ?? new MemoryCheckpointStore(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  });
}

describe('AgentLoop with checkpoint', () => {
  it('creates checkpoint during tool execution', async () => {
    // Mock model: first call returns a tool-call, second call throws to prevent
    // normal completion (which would clean up the checkpoint).
    let callCount = 0;
    const mockModel: LanguageModelV4 = {
      specificationVersion: 'v4',
      provider: 'mock',
      modelId: 'mock-model',
      supportedUrls: {},
      doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
      doStream: vi.fn().mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: JSON.stringify({}) });
                controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } });
                controller.close();
              },
            }),
          } satisfies LanguageModelV4StreamResult;
        }
        throw new Error('model error');
      }),
    };

    const events = new MittEventRecorder<TurnEvent>();
    const checkpointStore = new MemoryCheckpointStore();
    const agent = new Agent({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'test-agent',
      systemPrompt: 'You are helpful.',
      model: mockModel,
      temperature: 0.7,
      maxTokens: 4096,
      maxSteps: 3,
      memory: new MemoryStore(),
      thread: new InMemoryThreadStore(),
      events,
      tracer: new TurnTracer(events, []),
      tools: [mockSearchTool],
      skills: [],
      approvalResolver: () => ({ approved: true }),
      checkpointStore,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });

    const loop = new AgentLoop({
      agent,
      processors: [new SystemPromptProcessor()],
    });

    const output = loop.run(
      { role: 'user', content: 'search' },
      { threadId: 'thread-1' },
    );
    // Turn fails on second model call; catch the rejection
    await output.result.catch(() => {});

    const ckpt = await checkpointStore.getByTurn(
      (await agent.thread.getLatestTurn('thread-1'))!.id,
    );
    expect(ckpt).toBeDefined();
    expect(ckpt!.completedToolResults).not.toHaveLength(0);
    expect(ckpt!.pendingToolCall).toBeNull();
  });

  it('removes checkpoint on turn completed', async () => {
    const checkpointStore = new MemoryCheckpointStore();
    const agent = makeAgent([
      { type: 'text-start', id: '1' },
      { type: 'text-delta', id: '1', delta: 'Hello!' },
      { type: 'text-end', id: '1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } },
    ], checkpointStore);

    const loop = new AgentLoop({
      agent,
      processors: [new SystemPromptProcessor()],
    });

    const result = await collectTurnResult(loop.run(
      { role: 'user', content: 'hi' },
      { threadId: 'thread-1' },
    ));
    expect(result.status).toBe('completed');

    const ckpt = await checkpointStore.getByTurn(result.turn.id);
    expect(ckpt).toBeUndefined();
  });
});
