// @vico/core - Memory 层共享常量与列契约

/**
 * `vico_memory_entries` 表列契约（working / semantic 共享同一张表，按 `type` 列分义）。
 *
 * `scope_type` 列的含义由 `type` 决定：
 * - `type = 'working'` 的行：`scope_type` 存作用域维度（恒为 `WORKING_MEMORY_SCOPE_TYPE = 'user'`），
 *   `scope_id` 存具体 userId。由 WorkingMemory 实现（Drizzle）读写。
 * - `type = 'semantic'` 的行：`scope_type` 存向量索引名（语义记忆为 `MEMORY_INDEX_NAME`，
 *   RAG 知识库为 `kbIndexName(kbId)`），`scope_id` 存该向量的归属标识（语义记忆为 userId）。
 *   由 VectorStore 实现（原生 SQL）读写。
 *
 * 因此不要在 `scope_type` 上做跨 type 的统一假设，查询时始终配合 `type` 过滤。
 */

/** 语义记忆向量索引名 — 作为 `type='semantic'` 行的 `scope_type` 取值 */
export const MEMORY_INDEX_NAME = 'memory';

/** 工作记忆行的 `scope_type` 取值 — 表示 user 级作用域 */
export const WORKING_MEMORY_SCOPE_TYPE = 'user';

/** `vico_memory_entries.type` 列的取值 */
export const MEMORY_ENTRY_TYPE = {
  working: 'working',
  semantic: 'semantic',
} as const;

/** 会话历史默认滑动窗口大小（已完成轮次数），未被显式配置覆盖时的兜底值 */
export const DEFAULT_CONVERSATION_WINDOW = 10;
