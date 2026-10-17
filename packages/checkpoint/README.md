# @vico/checkpoint

检查点（断点续传）。

定义 `CheckpointStore` 端口、Checkpoint 数据模型与版本迁移，提供内存实现；支持 turn 中断后从检查点恢复（含审批待办、暂停项）。

## 主要导出

- 数据模型与端口 — `Checkpoint` / `CheckpointAppendPatch` / `CheckpointStore` / `NextAction` / `CheckpointApprovalCalls`
- 构造与迁移 — `createCheckpoint` / `checkpointMigrations` / `CHECKPOINT_CURRENT_VERSION` / `DEFAULT_CHECKPOINT_TTL`
- `MemoryCheckpointStore` — 内存版 CheckpointStore

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/types` | 基础数据契约 |
| `@vico/tool`（type） | ToolCall / ToolResult 类型 |

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
