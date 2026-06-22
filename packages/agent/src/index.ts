// src/index.ts — @vico/agent public API

export { AgentConfigSchema, type AgentConfig, type ModelRef } from './agent-loop/types.js';
export {
  ToolCallSchema,
  ToolResultSchema,
  ToolPolicySchema,
  ToolKindSchema,
  type Tool,
  type ToolCall,
  type ToolResult,
  type ToolPolicy,
  type ToolKind,
} from './tool/types.js';
export { MemoryRecordSchema, type MemoryRecord } from './memory/types.js';
export { SSEEventSchema, SpanTypeSchema, type SSEEvent, type SpanType } from './observable/types.js';

// Ports — Model
export {
  type ModelMessage,
  type MessageRole,
} from './model/types.js';
export { createLanguageModel } from './model/factory.js';

// Context processors (onion model)
export {
  type ContextProcessor,
  type ModelRequestContext,
  ProcessorPipeline,
  buildModelRequest,
  Priority,
} from './prompt/context-processor.js';

export { SystemPromptProcessor } from './prompt/system-prompt-processor.js';
export { SkillProcessor } from './skill/skill-processor.js';
export { MemoryProcessor } from './memory/memory-processor.js';
export { RagProcessor } from './rag/rag-processor.js';
export { DynamicInstructionProcessor } from './agent-loop/dynamic-instruction-processor.js';

export { type SkillCatalogEntry } from './skill/types.js';
export {
  type RagChunk,
  type RagProvider,
} from './rag/types.js';
export {
  type BatchEmbedder,
  type BatchEmbedOptions,
  type BatchEmbedResult,
} from '@vico/rag';
export {
  type SemanticRecallMemory,
  type WorkingMemory,
} from './memory/types.js';

// Tool system
export { ToolBroker } from './tool/tool-broker.js';
export {
  type ToolExecutionContext,
  type ApprovalDecision,
  type ToolStore,
} from './tool/types.js';
export { type ToolSource } from './tool/types.js';
export { ChildAgentExecutor } from './tool/child-agent-executor.js';
export { type ChildAgentRef, type DelegateStrategy } from './tool/types.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { resolvePolicy } from './tool/tool-policy.js';
export { type PolicyContext } from './tool/types.js';
export { createBuiltInToolSource } from './tool/builtin-tools-source.js';

// Builtin tools (individual exports)
export {
  readTool,
  bashTool,
  editTool,
  writeTool,
  grepTool,
  findTool,
  lsTool,
  lspTool,
  coreBuiltinTools,
} from './tool/builtin/index.js';

// Ports — MemoryStore
export { MemoryStore, type MemoryStoreOptions } from './memory/memory-store.js';
export { ConversationHistoryMemory } from './memory/conversation-history-memory.js';
export { InMemoryWorkingMemory } from './memory/working/in-memory-working-memory.js';
export { FileWorkingMemory, type FileWorkingMemoryOptions } from './memory/working/file-working-memory.js';
export { createUpdateWorkingMemoryTool } from './memory/working/working-memory-tool.js';
export { VectorSemanticRecall, type VectorSemanticRecallOptions } from './memory/semantic/vector-semantic-recall.js';

// Ports — SkillLoader
export { type SkillLoader, type Skill, type SkillStore } from './skill/types.js';

// Skill system
export { FSSkillLoader } from './skill/fs-skill-loader.js';
export { SkillManager } from './skill/skill-manager.js';
export { createSkillToolSource } from './skill/skill-tool-source.js';
export { formatSkillCatalog } from './skill/skills-processor.js';
export { ManagedSkillStore } from './skill/managed-skill-store.js';

/** Ports — ThreadStore */
export {
  type ThreadStore,
  type Thread,
  type Turn,
  type Message,
} from './thread/types.js';
export { InMemoryThreadStore } from './thread/memory-thread-store.js';
export { FileThreadStore, type FileThreadStoreOptions } from './thread/file-thread-store.js';

// ContextCompactor
export { ContextCompactor } from './agent-loop/context-compactor.js';

// Observable
export { MittEventRecorder } from './observable/event-recorder.js';
export { type EventRecorder } from './observable/types.js';
export { InMemorySpanTracker } from './observable/span-tracker.js';
export { type SpanTracker, type Span } from './observable/types.js';

// AgentRuntime
export { AgentRuntime } from './agent-loop/agent-runtime.js';
export { Agent } from './agent-loop/types.js';

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
