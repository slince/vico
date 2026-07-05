// src/index.ts — @vico/agent public API

export { type ModelRef } from './agent-loop/types.js';
export { type LanguageModelFactory, type AgentConfig } from './agent-loop/create-agent.js';
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
export type { UIStreamChunk, UIMessage, UIMessagePart, UserMessage } from './stream/types.js';
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
  type ToolCallContext,
  type ApprovalDecision,
} from './tool/types.js';
export { type TurnSession } from './agent-loop/types.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { resolvePolicy } from './tool/utils.js';
export { type PolicyContext, type ApprovalResolver } from './tool/types.js';
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
  webFetchTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitCheckoutTool,
  packageInstallTool,
  packageRunTool,
  todoTool,
  createDelegateTool,
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  basicTools,
  filesystemTools,
  codingTools,
  baseBuiltinTools,
  fileBuiltinTools,
  coreBuiltinTools,
  resolveWorkspacePath,
} from './tool/builtin/index.js';

// Ports — MemoryStore
export { MemoryStore, type MemoryStoreOptions } from './memory/memory-store.js';
export { ConversationHistoryMemory } from './memory/conversation-history-memory.js';
export { InMemoryWorkingMemory } from './memory/working/in-memory-working-memory.js';
export { FileWorkingMemory, type FileWorkingMemoryOptions } from './memory/working/file-working-memory.js';
export { createUpdateWorkingMemoryTool } from './memory/tool/working-memory-tool.js';
export { VectorSemanticRecall, type VectorSemanticRecallOptions } from './memory/semantic/vector-semantic-recall.js';

// Ports — SkillLoader
export { type SkillLoader, type Skill } from './skill/types.js';

// Skill system
export { createFSSkillLoader } from './skill/fs-skill-loader.js';
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
  TurnTrace,
  type TraceLevel,
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
export { createAgent } from './agent-loop/create-agent.js';

// AgentLoop
export { AgentLoop } from './agent-loop/agent-loop.js';
export { type AgentLoopOptions, type CallModelResult } from './agent-loop/agent-loop.js';
export { collectTurnResult } from './agent-loop/utils.js';
export { TurnOutput } from './agent-loop/turn-output.js';
export { type TurnResult, type TurnEvent, type RunOptions, type ToolApproval, type PauseInfo } from './agent-loop/types.js';
export { TokenEconomy } from './agent-loop/token-economy.js';

// Stream
export { turnOutputToSSEResponse } from './stream/turn-stream.js';

// Container
export {
  Vico,
  type VicoOptions,
} from './container/vico.js';
