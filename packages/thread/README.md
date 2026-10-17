# @vico/thread

线程/会话存储与消息转换。

定义 `ThreadStore` 端口与 Thread / Turn / Message 数据模型，提供内存实现与 AI SDK 消息互转。

## 快速使用

```ts
import { InMemoryThreadStore, toModelMessages } from '@vico/thread';

// 内存版 ThreadStore（进程重启丢失）
const store = new InMemoryThreadStore();

await store.createThread('agent-1', '会话标题', 'thread-1', { userId: 'user-1' });
const thread = await store.getThread('thread-1');
const threads = await store.listThreads({ agentId: 'agent-1' });

// 消息转 AI SDK 模型格式（入参为 Message[]）
const modelMessages = toModelMessages(await store.getEntries('thread-1'));
```

## 相关文档

- [thread token 用量](../../docs/insights/thread-token-usage.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
