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

// Ports — Model（消息/流类型全部 re-export AI SDK 原生类型）
export type { ModelMessage, UIMessage, UIMessageChunk, ToolSet } from 'ai';
export { convertToModelMessages, validateUIMessages } from 'ai';
export { createLanguageModel } from './model/factory.js';

// ModelClient and types
export { ModelClient } from './model/model-client.js';
export type { ModelRequest, ModelStreamResult, ReasoningEffort } from './model/types.js';
export {
  getMessageText, getToolCalls, hasToolResult, getToolResultText,
  buildAssistantMessage, buildToolResultMessage, modelMessageToUIMessage, toToolSet,
  buildApprovalResponseMessage, extractApprovalResponses, pickPrimaryUserMessage,
} from './model/message-utils.js';

// Stream
export type { UserMessage } from './stream/types.js';

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
export { WorkspaceToolProcessor } from './agent-loop/context-processors/workspace-tool-processor.js';

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
export { createTool, type ToolOptions } from './tool/create-tool.js';
export { ToolExecutor } from './agent-loop/tool-executor.js';
export {
  type ToolCallContext,
  type ApprovalDecision,
} from './tool/types.js';
export { type TurnSession, type CallModelResult } from './agent-loop/agent-loop-options.js';
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
} from './thread/thread-store.js';
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
export { Agent, type AgentOptions } from './agent-loop/agent.js';
export { createAgent } from './agent-loop/create-agent.js';

// AgentLoop
export { AgentLoop } from './agent-loop/agent-loop.js';
export { type AgentLoopOptions } from './agent-loop/agent-loop.js';
export { collectTurnResult, normalizeUserMessage, extractApprovalDecisions } from './agent-loop/utils.js';
export { TurnOutput } from './agent-loop/turn-output.js';
export { type TurnEvent } from './agent-loop/types.js';
export { type TurnResult, type RunOptions, type ToolApproval } from './agent-loop/agent-loop-options.js';
export { type PauseInfo, type Checkpoint, type CheckpointStore, CHECKPOINT_CURRENT_VERSION, checkpointMigrations, DEFAULT_CHECKPOINT_TTL } from './agent-loop/checkpoint.js';
export { TokenEconomy } from './agent-loop/token-economy.js';

// Stream
export { turnOutputToSSEResponse } from './stream/turn-stream.js';
export { type AgentStreamPart } from './agent-loop/stream-parts.js';

// Container
export {
  Vico,
  type VicoOptions,
} from './container/vico.js';
