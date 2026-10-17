# @vico/types

跨包共享的基础数据契约（零内部依赖的叶子包）：token 用量、工具审批状态。

## 快速使用

```ts
import type { UsageMetrics, ToolCallApproval, ToolApproval } from '@vico/types';

// 客户端工具审批决策（toolCallId 与审批结果绑定）
const approval: ToolCallApproval = {
  toolCallId: 'call_1',
  approved: true,
  scope: 'turn', // turn（本 turn 有效）| session（整个 thread 有效）
};

// 单次工具审批在 turn 内的状态记录
const approved: ToolApproval = {
  toolName: 'bash',
  approved: true,
  approvedAt: Date.now(),
};

// 单次模型调用用量明细（字段可能为 undefined：provider 未上报时）
const usage: UsageMetrics = {
  inputTokens: { total: 120, cacheRead: 40 },
  outputTokens: { total: 60, reasoning: 20 },
};
```

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
