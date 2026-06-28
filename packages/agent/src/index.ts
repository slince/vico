// src/index.ts — @vico/agent public API

export { type ModelRef, type LanguageModelFactory, type AgentConfig } from './agent-loop/types.js';
export {
  type Tool,
  type ToolCall,
  type ToolResult,
  type ToolPolicy,
  type ToolKind,
} from './tool/types.js';
export { type MemoryRecord } from './memory/types.js';
export { type SpanType } from './observable/types.js';

// Ports — Model
export {
  type ModelMessage,
  type MessageRole,
} from './model/types.js';
export { createLanguageModel } from './model/factory.js';

// ModelClient and types
export { ModelClient } from './model/model-client.js';
export type {
  ModelStreamChunk,
  ModelRequest,
  ModelStreamResult,
  ToolDescriptor,
} from './model/types.js';

// Stream
export type { UIStreamChunk } from './stream/types.js';
export { createSSEResponse } from './stream/sse.js';

// Context processors (onion model)
export {
  type ContextProcessor,
  type ModelRequestContext,
  type AgentRef,
  ProcessorPipeline,
  buildModelRequest,
  Priority,
} from './agent-loop/context-processors/context-processor.js';

export { SystemPromptProcessor } from './agent-loop/context-processors/system-prompt-processor.js';
export { SkillProcessor } from './agent-loop/context-processors/skill-processor.js';
export { MemoryProcessor } from './agent-loop/context-processors/memory-processor.js';
export { RagProcessor } from './agent-loop/context-processors/rag-processor.js';
export { DynamicInstructionProcessor } from './agent-loop/context-processors/dynamic-instruction-processor.js';

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
export { createTool, toToolDescriptor, type ToolOptions } from './tool/create-tool.js';
export { ToolBroker } from './tool/tool-broker.js';
export {
  type ToolExecutionContext,
  type ApprovalDecision,
  type ToolStore,
} from './tool/types.js';
export { type TurnSession } from './agent-loop/types.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { resolvePolicy } from './tool/utils.js';
export { type PolicyContext } from './tool/types.js';
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
  echoTool,
  nowTool,
  coreBuiltinTools,
} from './tool/builtin/index.js';

// Ports — MemoryStore
export { MemoryStore, type MemoryStoreOptions } from './memory/memory-store.js';
export { ConversationHistoryMemory } from './memory/conversation-history-memory.js';
export { InMemoryWorkingMemory } from './memory/working/in-memory-working-memory.js';
export { FileWorkingMemory, type FileWorkingMemoryOptions } from './memory/working/file-working-memory.js';
export { createUpdateWorkingMemoryTool } from './memory/tool/working-memory-tool.js';
export { VectorSemanticRecall, type VectorSemanticRecallOptions } from './memory/semantic/vector-semantic-recall.js';

// Ports — SkillLoader
export { type SkillLoader, type Skill, type SkillStore } from './skill/types.js';

// Skill system
export { FSSkillLoader } from './skill/fs-skill-loader.js';
export { SkillRegistry } from './skill/skill-registry.js';
export { createSkillLoadTool, createSkillSearchTool, createSkillReadTool } from './skill/tool/index.js';

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

// Observable (Span + Trace)
export { type Span, type SpanState } from './observable/types.js';
export {
  TurnTracer,
  TurnTraceSession,
  type TraceLevel,
  type TurnTrace,
} from './observable/turn-tracer.js';
export {
  createAdaptersFromLevel,
  type TraceAdapter,
} from './observable/trace-adapter.js';
export { ConsoleTraceAdapter } from './observable/console-trace-adapter.js';
export { FileTraceAdapter, DEFAULT_TRACE_DIR, type FileTraceAdapterOptions } from './observable/file-trace-adapter.js';
export type { TraceOptions } from './container/options.js';

// Events
export { MittEventRecorder } from './events/event-recorder.js';
export { type EventRecorder, type EventPayload, type TypedEvent } from './events/types.js';

// AgentRuntime
export { AgentRuntime } from './agent-loop/agent-runtime.js';

// Agent
export { Agent, type AgentOptions, type InvokeOptions } from './agent-loop/agent.js';
export { createAgent, type BuildAgentOptions } from './agent-loop/create-agent.js';

// AgentLoop
export { AgentLoop } from './agent-loop/agent-loop.js';
export { type AgentLoopOptions, type CallModelResult } from './agent-loop/agent-loop.js';
export { collectTurnResult } from './agent-loop/utils.js';
export { TurnOutput } from './agent-loop/turn-output.js';
export { type TurnResult, type TurnEvent, type RunTurnOptions } from './agent-loop/types.js';
export { TokenEconomy } from './agent-loop/token-economy.js';
export { ApprovalGate, type ApprovalHandler } from './agent-loop/approval-gate.js';

// Stream
export { turnEventsToAISDK } from './stream/turn-stream.js';

// Container
export {
  Vico,
  type VicoOptions,
} from './container/vico.js';
