# @vico/compaction

上下文压缩。

在上下文逼近 token 上限时，把历史轮次压缩为结构化摘要（含检查点前导），提供 token 估算与压缩配置解析。

## 快速使用

```ts
import { ModelContextCompactor, isContextOverflowError } from '@vico/compaction';

const compactor = new ModelContextCompactor({
  thread: threadStore, // @vico/thread 的 ThreadStore
  conversationWindow: 10,
  modelConfig: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY!,
    contextWindow: 128000, // pressure 触发时必填
    maxOutputTokens: 4096,
  },
});

// 按需触发：pressure（窗口压力）或 context-overflow（模型报错超限）
const result = await compactor.compactIfNeeded(
  thread,
  modelClient,
  'pressure',
  new AbortController().signal,
);

// 模型上下文超限错误检测
if (isContextOverflowError(err)) { /* ... */ }
```

## 相关文档

- [context-compaction 实现说明](../../docs/insights/context-compaction-实现说明.md)
