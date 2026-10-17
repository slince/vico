# @vico/checkpoint

检查点（断点续传）。

定义 `CheckpointStore` 版本树端口与 Checkpoint 快照模型，提供内存实现；支持 turn 中断后从检查点恢复（含审批待办、暂停项）。

## 快速使用

```ts
import { MemoryCheckpointStore } from '@vico/checkpoint';

const store = new MemoryCheckpointStore();

// turn 开始时创建初始版本（version=1、parentId=null、nextAction=model）
const ckpt = await store.create('turn-1', 'thread-1');

// 追加一个版本（patch 全字段覆盖最新快照，parentId 表达血缘）
await store.append(ckpt, {
  parentId: ckpt.id,
  stepIndex: 1,
  nextAction: 'model',
  decisions: [],
  approvedTools: [],
  pendingApprovalCalls: [],
  approvedCalls: [],
  deniedResults: [],
  lastMessageId: null,
});

// 读取最新版本 / 版本树
const latest = await store.getLatest('turn-1');
const versions = await store.listVersions('turn-1');
```

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
