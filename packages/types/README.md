# @vico/types

跨包共享的基础数据契约（零内部依赖的叶子包）。

只承载多个域都要用到、且自身无领域归属的纯结构类型；域类型一律留在各自域包（见 [@vico/core 拆分方案](../core/SPLIT-PLAN.md)）。

## 主要导出

- `UsageMetrics` — 单次模型调用的完整用量明细（输入/输出 token，含缓存读写与推理 token）
- `ToolCallApproval` — 客户端工具审批决策（toolCallId + approved + scope）
- `ToolApproval` — 单次工具审批在 turn 内的状态记录

## 依赖

零内部依赖。

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
