// @vico/memory - 双层记忆 + 会话历史

export {
  type MemoryRecord,
  type MemorySearchResult,
  type EpisodicMemory,
  type SemanticMemory,
  type ProceduralMemory,
} from './types.js';
export { MemoryStore, type MemoryStoreOptions } from './memory-store.js';
export { ConversationHistoryMemory } from './conversation-history-memory.js';
export { FileSemanticMemory, type FileSemanticMemoryOptions } from './semantic/file-semantic-memory.js';
export { DEFAULT_SEMANTIC_MEMORY_TEMPLATE } from './semantic/default-template.js';
export { createUpdateSemanticMemoryTool } from './tool/semantic-memory-tool.js';
export { VectorEpisodicRecall, type VectorEpisodicRecallOptions } from './episodic/vector-episodic-recall.js';
export {
  EPISODIC_INDEX_NAME,
  SEMANTIC_MEMORY_SCOPE_TYPE,
  MEMORY_ENTRY_TYPE,
  DEFAULT_CONVERSATION_WINDOW,
} from './constants.js';
