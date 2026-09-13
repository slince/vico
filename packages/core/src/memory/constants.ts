// @vico/core - Memory 层共享常量与列契约

/**
 * `vico_memory_entries` 表列契约（semantic / episodic / knowledge 共享同一张表，按 `type` 列分义）。
 *
 * `scope_type` 列的含义由 `type` 决定：
 * - `type = 'semantic'` 的行：`scope_type` 存作用域维度（恒为 `SEMANTIC_MEMORY_SCOPE_TYPE = 'user'`），
 *   `scope_id` 存具体 userId。由 SemanticMemory 实现（Drizzle）读写。
 * - `type = 'episodic'` 的行：`scope_type` 存向量索引名（情景记忆为 `EPISODIC_INDEX_NAME`），
 *   `scope_id` 存该向量的归属标识（情景记忆为 userId）。
 * - `type = 'knowledge'` 的行：`scope_type` 存 RAG 知识库向量索引名（`kbIndexName(kbId)`），
 *   `scope_id` 存 kbId。由 VectorStore 实现（原生 SQL）读写。
 *
 * 因此不要在 `scope_type` 上做跨 type 的统一假设，查询时始终配合 `type` 过滤。
 */

/** 情景记忆向量索引名 — 作为 `type='episodic'` 行的 `scope_type` 取值 */
export const EPISODIC_INDEX_NAME = 'episodic';

/** 语义记忆行的 `scope_type` 取值 — 表示 user 级作用域 */
export const SEMANTIC_MEMORY_SCOPE_TYPE = 'user';

/** `vico_memory_entries.type` 列的取值 */
export const MEMORY_ENTRY_TYPE = {
  semantic: 'semantic',
  episodic: 'episodic',
  knowledge: 'knowledge',
} as const;

/** 会话历史默认滑动窗口大小（已完成轮次数），未被显式配置覆盖时的兜底值 */
export const DEFAULT_CONVERSATION_WINDOW = 10;
