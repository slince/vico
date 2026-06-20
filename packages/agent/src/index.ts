// src/index.ts — @vico/agent public API

// Contracts
export { AgentConfigSchema, type AgentConfig, type ModelRef } from './contracts/agent.js';
export {
  ToolSpecSchema,
  ToolCallSchema,
  ToolResultSchema,
  ToolPolicySchema,
  ToolKindSchema,
  type ToolSpec,
  type ToolCall,
  type ToolResult,
  type ToolPolicy,
  type ToolKind,
} from './contracts/tool.js';
export { MemoryRecordSchema, type MemoryRecord } from './contracts/memory.js';
export { SSEEventSchema, SpanTypeSchema, type SSEEvent, type SpanType } from './contracts/events.js';

// Ports — ModelClient
export {
  type ModelClient,
  type ModelRequest,
  type ModelMessage,
  type ModelStreamChunk,
  type MessageRole,
} from './model/model-client.js';
export { AISDKModelClient } from './model/ai-sdk-adapter.js';

// Ports — PromptAssembler
export {
  type PromptAssembler,
  type PromptContext,
  type SkillCatalogEntry,
  type RagChunk,
  PromptAssemblerImpl,
} from './prompt/assembler.js';

// Ports — ToolHost
export {
  type ToolHost,
  type ToolExecutionContext,
  type ApprovalDecision,
} from './tool/tool-host.js';

// Ports — MemoryStore
export { type MemoryStore } from './memory/memory-store.js';

// Ports — SkillLoader
export { type SkillLoader, type Skill } from './skill/skill-loader.js';

// Ports — SessionStore
export {
  type SessionStore,
  type Thread,
  type Turn,
  type ConversationEntry,
} from './session/session-store.js';

// Ports — ContextCompactor
export { type ContextCompactor } from './agent-loop/context-compactor.js';

// Ports — Hook
export {
  type HookRunner,
  type HookEvent,
  type HookResult,
} from './hook/hook-types.js';
export { HookRunnerImpl, CompositeHookRunner } from './hook/hook-runner.js';

// Ports — Observable
export { type EventRecorder, MittEventRecorder } from './observable/event-recorder.js';
export {
  type SpanTracker,
  type Span,
  InMemorySpanTracker,
} from './observable/span-tracker.js';

// Runtime
export {
  type AgentRuntime,
  type Agent,
  type AgentFactory,
  AgentRuntimeImpl,
} from './agent-runtime/agent-runtime.js';

// AgentLoop
export {
  type AgentLoop,
  type AgentLoopOptions,
  type TurnResult,
  AgentLoopImpl,
} from './agent-loop/agent-loop.js';
