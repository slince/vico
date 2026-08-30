// src/index.ts — @vico/core public API

export { type ModelRef } from './agent/types.js';
export { type LanguageModelFactory, type AgentConfig } from './agent/create-agent.js';
export {
  type Tool,
  type ToolCall,
  type ToolResult,
  type ToolPolicy,
  type ToolKind,
} from './tool/types.js';
export { type MemoryRecord, type MemorySearchResult } from './memory/types.js';

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
  type ContentPart,
} from './model/message-utils.js';

// Stream
export type { UserMessage } from './stream/types.js';

// Context processors (onion model)
export {
  ModelRequestContext,
  type AgentRef,
} from './agent/context-processors/model-request-context.js';
export { type ContextProcessor } from './agent/context-processors/context-processor.js';
export {
  ProcessorPipeline,
  buildModelRequest,
  Priority,
} from './agent/context-processors/context-processor.js';

export { SystemPromptProcessor } from './agent/context-processors/system-prompt-processor.js';
export { SkillProcessor } from './agent/context-processors/skill-processor.js';
export { MemoryProcessor } from './agent/context-processors/memory-processor.js';
export { RagProcessor } from './agent/context-processors/rag-processor.js';
export { WorkspaceToolProcessor } from './agent/context-processors/workspace-tool-processor.js';

export {
  type RagChunk,
  type RagProvider,
} from './rag/types.js';
export {
  type Embedder,
  type EmbedOptions,
  type EmbedResult,
} from '@vico/rag';
export {
  type SemanticRecallMemory,
  type WorkingMemory,
} from './memory/types.js';

// Tool system
export { createTool, type ToolOptions } from './tool/create-tool.js';
export { ToolExecutor } from './agent/tool-executor.js';
export {
  type ToolCallContext,
  type ApprovalDecision,
} from './tool/types.js';
export { type TurnSession, type CallModelResult } from './agent/loop-agent-options.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { type PolicyContext, type ApprovalResolver, type ApprovalDecider } from './tool/types.js';
export { isPathInWorkspace, composeResolvers, defaultApprovalResolvers, neverDenyResolver, workspaceResolver, defaultResolver } from './tool/policy-helpers.js';
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
export { FileWorkingMemory, type FileWorkingMemoryOptions } from './memory/working/file-working-memory.js';
export { DEFAULT_WORKING_MEMORY_TEMPLATE } from './memory/working/default-template.js';
export { createUpdateWorkingMemoryTool } from './memory/tool/working-memory-tool.js';
export { VectorSemanticRecall, type VectorSemanticRecallOptions } from './memory/semantic/vector-semantic-recall.js';
export {
  MEMORY_INDEX_NAME,
  WORKING_MEMORY_SCOPE_TYPE,
  MEMORY_ENTRY_TYPE,
  DEFAULT_CONVERSATION_WINDOW,
} from './memory/constants.js';

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
  type ThreadMetadata,
  type Turn,
  type Message,
  type SessionApprovedTool,
} from './thread/thread-store.js';
export { InMemoryThreadStore } from './thread/memory-thread-store.js';
export { toModelMessages, fromModelMessage, toUiMessages } from './thread/utils.js';

// ContextCompactor
export { ContextCompactor } from './agent/context-compactor.js';

// Utils
export { KeyedMutex } from './utils/async-keyed-lock.js';

// Events
export { MittEventRecorder } from './events/event-recorder.js';
export { type EventRecorder, type EventPayload, type TypedEvent } from './events/types.js';

// AgentRuntime
export { AgentRuntime } from './agent/agent-runtime.js';

// Agent
export type { Agent, AgentOptions, CreateThreadOptions } from './agent/agent.js';
export { createAgent } from './agent/create-agent.js';

// LoopAgent（Agent 默认实现）
export { LoopAgent, type LoopAgentOptions } from './agent/loop-agent.js';
export { collectTurnResult, normalizeUserMessage } from './agent/utils.js';
export { TurnOutput } from './agent/turn-output.js';
export { type TurnEvent } from './agent/types.js';
export { type TurnResult, type RunOptions, type ToolApproval, type ToolCallApproval } from './agent/loop-agent-options.js';
export { type PauseInfo, type Checkpoint, type CheckpointAppendPatch, type CheckpointStore, type NextAction, CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint, DEFAULT_CHECKPOINT_TTL } from './agent/checkpoint.js';
export { TokenEconomy } from './agent/token-economy.js';

// Container
export {
  Vico,
  type VicoOptions,
} from './agent/vico.js';
