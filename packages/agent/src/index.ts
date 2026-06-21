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
  type ModelClientFactory,
} from './model/model-client.js';
export { AISDKModelClient } from './model/ai-sdk-adapter.js';
export { defaultModelFactory } from './model/factory.js';

// Context processors (onion model)
export {
  type ContextProcessor,
  type ModelRequestContext,
  OnionPipeline,
  buildModelRequest,
  Priority,
} from './prompt/context-processor.js';

export { SystemPromptProcessor } from './prompt/system-prompt-processor.js';
export { SkillCatalogProcessor } from './skill/skill-catalog-processor.js';
export { MemoryProcessor } from './memory/memory-processor.js';
export { RagProcessor } from './memory/rag-processor.js';
export { DynamicInstructionProcessor } from './agent-loop/dynamic-instruction-processor.js';

export { type SkillCatalogEntry } from './skill/types.js';
export {
  type RagChunk,
  type RagProvider,
  type ConversationHistoryMemory,
  type SemanticRecallMemory,
  type WorkingMemory,
} from './memory/types.js';

// Ports — ToolHost
export {
  type ToolHost,
  type ToolExecutionContext,
  type ApprovalDecision,
  type ToolStore,
} from './tool/tool-host.js';

// Tool system
export { LocalToolHost, type ToolSource, type ToolHandler } from './tool/local-tool-host.js';
export { ChildAgentExecutor, type ChildAgentRef, type DelegateStrategy } from './tool/child-agent-executor.js';
export { CapabilityRegistry } from './tool/capability-registry.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { resolvePolicy, type PolicyContext } from './tool/tool-policy.js';
export { BuiltinTools } from './tool/builtin-tools.js';

// Ports — MemoryStore
export { type MemoryStore } from './memory/memory-store.js';
export { ConversationHistoryMemoryStore } from './memory/conversation-history-memory.js';
export { InMemoryMemoryStore } from './memory/memory-store-impl.js';

// Ports — SkillLoader
export { type SkillLoader, type Skill, type SkillStore } from './skill/types.js';

// Skill system
export { FSSkillLoader } from './skill/fs-skill-loader.js';
export { SkillManager } from './skill/skill-manager.js';
export { createSkillTools, createSkillToolHandlers } from './skill/skill-tools.js';
export { formatSkillCatalog } from './skill/skills-processor.js';
export { ManagedSkillStore } from './skill/managed-skill-store.js';

/** Ports — SessionStore */
export {
  type SessionStore,
  type Thread,
  type Turn,
  type Message,
} from './session/session-store.js';
export { InMemorySessionStore } from './session/memory-session-store.js';
export { FileSessionStore, type FileSessionStoreOptions } from './session/file-session-store.js';

// ContextCompactor
export { ContextCompactor } from './agent-loop/context-compactor.js';

// Hook
export {
  type HookEvent,
  type HookResult,
} from './hook/hook-types.js';
export { HookRunner, CompositeHookRunner } from './hook/hook-runner.js';

// Observable
export { type EventRecorder, MittEventRecorder } from './observable/event-recorder.js';
export {
  type SpanTracker,
  type Span,
  InMemorySpanTracker,
} from './observable/span-tracker.js';

// AgentRuntime
export {
  AgentRuntime,
} from './agent-loop/agent-runtime.js';
export {
  Agent,
  type AgentFactory,
} from './agent-loop/types.js';

// AgentLoop
export {
  AgentLoop,
  type AgentLoopOptions,
  type TurnResult,
} from './agent-loop/agent-loop.js';
export { TokenEconomy } from './agent-loop/token-economy.js';
export { ApprovalGate, type ApprovalHandler } from './agent-loop/approval-gate.js';

// Container
export {
  Vico,
  type VicoOptions,
} from './container/vico.js';
