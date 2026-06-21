// src/index.ts — @vico/agent public API

export { AgentConfigSchema, type AgentConfig, type ModelRef } from './agent-loop/types.js';
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
} from './tool/types.js';
export { MemoryRecordSchema, type MemoryRecord } from './memory/types.js';
export { SSEEventSchema, SpanTypeSchema, type SSEEvent, type SpanType } from './observable/types.js';

// Ports — ModelClient
export {
  type ModelClient,
  type ModelRequest,
  type ModelMessage,
  type ModelStreamChunk,
  type MessageRole,
  type ModelClientFactory,
} from './model/types.js';
export { AISDKModelClient } from './model/ai-sdk-adapter.js';
export { defaultModelFactory } from './model/factory.js';

// Context processors (onion model)
export {
  type ContextProcessor,
  type ModelRequestContext,
  ProcessorPipeline,
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
  type Embedder,
  type SemanticRecallMemory,
  type WorkingMemory,
  type VectorStore,
} from './memory/types.js';

// Ports — ToolHost
export {
  type ToolHost,
  type ToolExecutionContext,
  type ApprovalDecision,
  type ToolStore,
} from './tool/types.js';

// Tool system
export { LocalToolHost } from './tool/local-tool-host.js';
export { type ToolSource, type ToolHandler } from './tool/types.js';
export { ChildAgentExecutor } from './tool/child-agent-executor.js';
export { type ChildAgentRef, type DelegateStrategy } from './tool/types.js';
export { CapabilityRegistry } from './tool/capability-registry.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { resolvePolicy } from './tool/tool-policy.js';
export { type PolicyContext } from './tool/types.js';
export { BuiltinTools } from './tool/builtin-tools.js';

// Ports — MemoryStore
export { MemoryStore, type MemoryStoreOptions } from './memory/memory-store.js';
export { ConversationHistoryMemory } from './memory/conversation-history-memory.js';
export { InMemorySemanticRecall } from './memory/in-memory-semantic-recall.js';
export { InMemoryWorkingMemory } from './memory/in-memory-working-memory.js';
export { InMemoryRagProvider } from './memory/in-memory-rag-provider.js';
export { FileWorkingMemory, type FileWorkingMemoryOptions } from './memory/file-working-memory.js';
export { InMemoryVectorStore } from './memory/in-memory-vector-store.js';
export { VectorSemanticRecall, type VectorSemanticRecallOptions } from './memory/vector-semantic-recall.js';

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
} from './session/types.js';
export { InMemorySessionStore } from './session/memory-session-store.js';
export { FileSessionStore, type FileSessionStoreOptions } from './session/file-session-store.js';

// ContextCompactor
export { ContextCompactor } from './agent-loop/context-compactor.js';

// Hook
export {
  type HookEvent,
  type HookResult,
} from './hook/types.js';
export { HookRunner, CompositeHookRunner } from './hook/hook-runner.js';

// Observable
export { MittEventRecorder } from './observable/event-recorder.js';
export { type EventRecorder } from './observable/types.js';
export { InMemorySpanTracker } from './observable/span-tracker.js';
export { type SpanTracker, type Span } from './observable/types.js';

// AgentRuntime
export { AgentRuntime } from './agent-loop/agent-runtime.js';
export { Agent, type AgentFactory } from './agent-loop/types.js';

// AgentLoop
export { AgentLoop, collectTurnResult } from './agent-loop/agent-loop.js';
export { type AgentLoopOptions, type TurnResult, type TurnEvent, type RunTurnOptions } from './agent-loop/types.js';
export { TokenEconomy } from './agent-loop/token-economy.js';
export { ApprovalGate, type ApprovalHandler } from './agent-loop/approval-gate.js';

// Container
export {
  Vico,
  type VicoOptions,
  type InvokeOptions,
} from './container/vico.js';
