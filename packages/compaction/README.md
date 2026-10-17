# @vico/compaction

上下文压缩。

在上下文逼近 token 上限时，把历史轮次压缩为摘要（含检查点前导），并提供 token 估算与压缩配置解析。

## 主要导出

- `ModelContextCompactor` — 模型驱动的上下文压缩器
- 错误与检测 — `ManualCompactionError` / `TargetPressureConfigError` / `isContextOverflowError` / `ManualCompactionErrorCode`
- 压缩配置 — `resolveSettings` / `resolveCompactSpec` / `selectCompactableRange` / `DEFAULT_COMPACTION_SETTINGS` 及类型（`CompactionSettings` / `ResolvedCompactionSettings` / `ResolvedCompactSpec` / `CompactionModelPolicy` / `TurnTokenBudget` / `CompactableRange`）
- token 估算 — `estimateContent` / `estimateMessage` / `measure` / `CHARS_PER_TOKEN` / `BLOCK_OVERHEAD` / `ROLE_OVERHEAD` 及类型
- 常量 — `COMPACTION_INSTRUCTION` / `CHECKPOINT_PREAMBLE` / `SUMMARY_OPEN_TAG` / `SUMMARY_CLOSE_TAG`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/model` | 模型调用 |
| `@vico/thread` | Thread / Turn 数据模型 |
| `@vico/utils` | 工具 |
| `ai` | AI SDK 类型 |

## 相关文档

- [context-compaction 实现说明](../../docs/insights/context-compaction-实现说明.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
