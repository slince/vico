# 记忆术语对齐主流认知科学命名

> 生成日期：2026-09-13
> 范围：`packages/core/src/memory/*`、三个 adapter、server 装配、web 工具/i18n

## 一、背景

vico 的记忆模块沿用了 Mastra 的术语体系，与主流框架（LangMem / Mem0）采用的认知科学三分法（episodic / semantic / procedural）存在「同名异义」冲突：

| 主流叫法 | 含义 | vico 旧叫法 | 冲突点 |
|---|---|---|---|
| **Episodic** 情景记忆 | 原始事件/经历文本，靠向量检索 | `SemanticRecallMemory`（语义召回） | 「semantic」被挪作他指 |
| **Semantic** 语义记忆 | 用户画像/事实，LLM 自主更新 | `WorkingMemory`（工作记忆） | 「working」是另一种分类维度 |
| **Procedural** 程序记忆 | 可复用行为/流程指令 | （无） | 缺失 |

核心矛盾：vico 的「working」= 主流的「semantic」，vico 的「semantic」= 主流的「episodic」，字面完全相反，极易误读。

## 二、重命名映射

| 原 vico 叫法 | 新叫法 | 类型/接口 |
|---|---|---|
| `WorkingMemory` | `SemanticMemory` | `types.ts` 中的接口 |
| `FileWorkingMemory` | `FileSemanticMemory` | `memory/semantic/file-semantic-memory.ts` |
| `createUpdateWorkingMemoryTool` | `createUpdateSemanticMemoryTool` | 工具名 `update_semantic_memory` |
| `SemanticRecallMemory` | `EpisodicMemory` | `types.ts` 中的接口 |
| `VectorSemanticRecall` | `VectorEpisodicRecall` | `memory/episodic/vector-episodic-recall.ts` |
| （新增占位） | `ProceduralMemory` | `types.ts` 中的接口，仅 get/set，暂无实现 |

目录同步重命名：`memory/working/` → `memory/semantic/`，`memory/semantic/` → `memory/episodic/`（先迁 semantic→episodic，再迁 working→semantic，避免路径冲突）。

## 三、数据库三值 type 改造

### 为什么不能简单改名

`vico_memory_entries` 表由三种记忆共享，靠 `type` 列分义。旧方案下 `type='semantic'` 同时被「语义召回」与「RAG 知识库」复用，仅靠 `scope_type` 区分：

- `type='semantic'` + `scope_type='memory'` → 语义召回（原文本向量）
- `type='semantic'` + `scope_type='kb_*'` → RAG 知识库向量

若把 `semantic` 直接改成 `episodic`，会把 RAG 数据一并污染。因此拆成三值。

### 迁移映射（幂等，位于 `ensureTables()`）

| 旧值 | 新值 | 判定条件 |
|---|---|---|
| `working` | `semantic` | `WHERE type='working'` |
| `semantic` | `episodic` | `WHERE type='semantic' AND scope_type='memory'` |
| `semantic` | `knowledge` | `WHERE type='semantic' AND scope_type LIKE 'kb_%'` |

`vico_index_config`：`index_name='memory'` → `'episodic'`（仅 libsql，mysql 无此表）。

迁移采用 `UPDATE ... WHERE type=旧值` 形式，重复执行无副作用（第二次执行时旧值已不存在，0 行匹配）。

### 迁移执行顺序（关键）

1. 先 `working → semantic`（此时原 `semantic` 仍是「召回+RAG」混合态）
2. 再 `semantic + scope_type='memory' → episodic`
3. 最后 `semantic + scope_type LIKE 'kb_%' → knowledge`

顺序不可颠倒，否则第 1 步会把旧 semantic 数据误当成 working 一并转掉。

## 四、列契约（`constants.ts`）

```ts
export const EPISODIC_INDEX_NAME = 'episodic';        // type='episodic' 行的 scope_type
export const SEMANTIC_MEMORY_SCOPE_TYPE = 'user';      // type='semantic' 行的 scope_type
export const MEMORY_ENTRY_TYPE = { semantic: 'semantic', episodic: 'episodic', knowledge: 'knowledge' } as const;
```

`scope_type` 含义随 `type` 变化：`semantic`→作用域维度（恒 `'user'`），`episodic`→向量索引名（恒 `'episodic'`），`knowledge`→RAG 索引名（`kb_*`）。查询时务必配合 `type` 过滤，勿在 `scope_type` 上做跨 type 假设。

## 五、代码结构变更要点

- **`MemoryStore`** 四层字段：`conversation / episodic / semantic / procedural`（后三者为长期记忆，`procedural` 暂未实现）。
- **`VectorStore` 接口**新增 `type?: string` 参数（默认 `'knowledge'`），`createIndex`/`upsert`/`query` 透传，用于区分 episodic 与 knowledge 两类向量。`deleteVectors`/`dropIndex` 因按索引名定位，无需 type。
- **`VectorEpisodicRecall`** 所有 store 调用显式传 `type='episodic'`；RAG 侧沿用默认 `'knowledge'`。
- **`FileSemanticMemory` / `LibSqlSemanticMemory` / `MysqlSemanticMemory`**：读写 `type='semantic'` + `scope_type='user'`，主键 `user:${scopeId}:semantic`。
- **上下文注入**：`injectWorkingMemory` → `injectSemanticMemory`（读 `memoryStore.semantic`），`injectSemanticRecall` → `injectEpisodicRecall`（读 `memoryStore.episodic`）；prompt 文本「工作记忆」→「语义记忆」、「语义召回」→「情景召回」。
- **工具**：`update_semantic_memory`（原 `update_working_memory`），web 侧 tool 定义/UI/i18n（zh-CN / zh-TW / en）同步改名。

## 六、注意

- `ProceduralMemory` 仅为占位接口，未接入 `MemoryStore` 装配、无 adapter 实现，属后续可落地的预留位。
- 迁移只处理存量数据，历史 `type` 取值若仍有第三方残留需另行排查（本次范围内已覆盖 working/semantic/memory/kb_* 全部已知形态）。
