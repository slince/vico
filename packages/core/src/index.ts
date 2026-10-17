// src/index.ts — @vico/core public API

export { type LanguageModelFactory, type AgentConfig } from '@vico/agent';
export {
  type Tool,
  type ToolCall,
  type ToolResult,
  type ToolPolicy,
  type ToolKind,
  type ToolTag,
} from '@vico/tool';
export { type MemoryRecord, type MemorySearchResult } from '@vico/memory';

// Ports — Model（消息/流类型全部 re-export AI SDK 原生类型）
export type { ModelMessage, UIMessage, UIMessageChunk, ToolSet } from 'ai';
export { convertToModelMessages, validateUIMessages } from 'ai';
export { createLanguageModel } from '@vico/model';

// ModelClient and types
export { ModelClient } from '@vico/model';
export type { ModelConfig, ModelRef, ModelRequest, ModelStreamResult, ReasoningEffort } from '@vico/model';
export {
  getMessageText,
  buildAssistantMessage, buildToolResultMessage, toToolSet,
  extractApprovalResponses, pickPrimaryUserMessage,
  type ContentPart,
} from '@vico/model';

// Stream
export type { CallModelResult, TurnEvent, UserMessage } from '@vico/stream';

// Context processors (onion model)
export {
  ModelRequestContext,
  type AgentRef,
} from '@vico/context';
export { type ContextProcessor } from '@vico/context';
export {
  ProcessorPipeline,
  buildModelRequest,
  Priority,
} from '@vico/context';

export { SystemPromptProcessor } from '@vico/context';
export { SkillProcessor } from '@vico/context';
export { MemoryProcessor } from '@vico/context';
export { RagProcessor } from '@vico/context';
export { WorkspaceToolProcessor } from '@vico/context';

export {
  type RagChunk,
  type RagProvider,
} from '@vico/rag';
export {
  type Embedder,
  type EmbedOptions,
  type EmbedResult,
} from '@vico/rag';
export {
  type EpisodicMemory,
  type SemanticMemory,
  type ProceduralMemory,
} from '@vico/memory';

// Tool system
export { createTool, type ToolOptions } from '@vico/tool';
export { ToolExecutor } from '@vico/tool';
export {
  type ToolCallContext,
  type ApprovalDecision,
} from '@vico/tool';
export { StormBreaker } from '@vico/tool';
export { type PolicyContext, type ApprovalResolver, type ApprovalDecider, type ApprovalMode } from '@vico/tool';
export { isPathInWorkspace, composeResolvers, defaultApprovalResolvers, toolPolicyResolver, approvalModeResolver, ApprovalPriority } from '@vico/tool';
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
  webFetchTool,
  todoTool,
  askUserTool,
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
} from '@vico/tool';
// Delegate tool（依赖 agent 运行时，故留在 agent 域）
export { createDelegateTool } from '@vico/agent';

// Ports — MemoryStore
export { MemoryStore, type MemoryStoreOptions } from '@vico/memory';
export { ConversationHistoryMemory } from '@vico/memory';
export { FileSemanticMemory, type FileSemanticMemoryOptions } from '@vico/memory';
export { DEFAULT_SEMANTIC_MEMORY_TEMPLATE } from '@vico/memory';
export { createUpdateSemanticMemoryTool } from '@vico/memory';
export { VectorEpisodicRecall, type VectorEpisodicRecallOptions } from '@vico/memory';
export {
  EPISODIC_INDEX_NAME,
  SEMANTIC_MEMORY_SCOPE_TYPE,
  MEMORY_ENTRY_TYPE,
  DEFAULT_CONVERSATION_WINDOW,
} from '@vico/memory';

// Ports — SkillLoader
export { type SkillLoader, type Skill } from '@vico/skill';

// Skill system
export { createFSSkillLoader } from '@vico/skill';
export { SkillRegistry } from '@vico/skill';
export { createSkillLoadTool, createSkillSearchTool, createSkillReadTool } from '@vico/skill';

/** Ports — ThreadStore */
export {
  type ThreadStore,
  type Thread,
  type ThreadMetadata,
  type Turn,
  type Message,
  type SessionApprovedTool,
  type TurnSession,
  type TurnStep,
} from '@vico/thread';
export { InMemoryThreadStore } from '@vico/thread';
export { toModelMessages, fromModelMessage, toUiMessages } from '@vico/thread';

// ContextCompactor（值导出：实现类 / 错误类 / 超限检测函数）
export {
  ModelContextCompactor,
  ManualCompactionError,
  TargetPressureConfigError,
  isContextOverflowError,
} from '@vico/compaction';
// ContextCompactor（类型导出：端口 / 结果 / 触发类型）
export type {
  ContextCompactor,
  CompactionTrigger,
  CompactionResult,
  ManualCompactionErrorCode,
  ModelContextCompactorOptions,
} from '@vico/compaction';
export {
  COMPACTION_INSTRUCTION,
  CHECKPOINT_PREAMBLE,
  SUMMARY_OPEN_TAG,
  SUMMARY_CLOSE_TAG,
} from '@vico/compaction';
export {
  resolveSettings,
  resolveCompactSpec,
  selectCompactableRange,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
  type ResolvedCompactionSettings,
  type ResolvedCompactSpec,
  type CompactionModelPolicy,
  type TurnTokenBudget,
  type CompactableRange,
} from '@vico/compaction';
export {
  estimateContent,
  estimateMessage,
  measure,
  CHARS_PER_TOKEN,
  BLOCK_OVERHEAD,
  ROLE_OVERHEAD,
  type TokenAnchor,
  type PricedMessage,
  type TokenMeasurement,
} from '@vico/compaction';

// Utils
export { KeyedMutex } from '@vico/utils';

// Events
export { MittEventRecorder } from '@vico/events';
export { type EventRecorder, type EventPayload, type TypedEvent } from '@vico/events';

// AgentRuntime
export { AgentRuntime } from '@vico/agent';

// Agent
export type { Agent, AgentOptions, CreateThreadOptions } from '@vico/agent';
export { createAgent } from '@vico/agent';

// LoopAgent（Agent 默认实现）
export { LoopAgent, type LoopAgentOptions } from '@vico/agent';
export { collectTurnResult, normalizeUserMessage } from '@vico/agent';
export { TurnOutput } from '@vico/agent';
export { type UsageMetrics } from '@vico/types';
export { type TurnResult, type RunOptions } from '@vico/agent';
export { type ToolApproval, type ToolCallApproval } from '@vico/types';
export { type Checkpoint, type CheckpointAppendPatch, type CheckpointStore, type NextAction, CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint, DEFAULT_CHECKPOINT_TTL } from '@vico/checkpoint';

// Container
export {
  Vico,
  type VicoOptions,
} from '@vico/agent';
