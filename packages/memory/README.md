# @vico/memory

双层记忆 + 会话历史。

语义记忆（SemanticMemory，结构化画像）、情景记忆（EpisodicMemory，向量召回）、程序记忆（ProceduralMemory）、会话历史与记忆管理工具。

## 主要导出

- 端口与类型 — `MemoryRecord` / `MemorySearchResult` / `EpisodicMemory` / `SemanticMemory` / `ProceduralMemory`
- `MemoryStore` — 组合内存实现
- `ConversationHistoryMemory` — 会话历史
- `FileSemanticMemory` — 文件版语义记忆
- `VectorEpisodicRecall` — 向量情景记忆召回
- `createUpdateSemanticMemoryTool` — 更新语义记忆的工具
- 常量 — `EPISODIC_INDEX_NAME` / `SEMANTIC_MEMORY_SCOPE_TYPE` / `MEMORY_ENTRY_TYPE` / `DEFAULT_CONVERSATION_WINDOW` / `DEFAULT_SEMANTIC_MEMORY_TEMPLATE`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/model` | 消息/模型类型 |
| `@vico/thread` | 会话数据模型 |
| `@vico/tool` | 工具框架 |
| `@vico/rag` | VectorStore 等检索端口 |
| `@vico/utils` | 工具 |
| `ai` / `zod` | AI SDK 类型 / 校验 |

## 相关文档

- [memory 术语重命名](../../docs/insights/memory-terminology-rename.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
