# @vico/stream

流式解析、用量计量与 turn 事件。

`ModelStreamReader` 消费 provider 原生 V4 流并转为引擎层 `TextStreamPart`；`usage` 系列提供用量累加与换算。

## 快速使用

```ts
import { emptyUsage, addUsage, fromV4Usage, ModelStreamReader } from '@vico/stream';

// 用量累加 / 换算（UsageMetrics）
const usage = addUsage(emptyUsage(), fromV4Usage(v4Usage));

// 消费 provider V4 流，逐 chunk 转 TextStreamPart 并累积结果
const reader = new ModelStreamReader({
  controller, // ReadableStreamDefaultController<TextStreamPart>
  emit: (event) => console.log(event), // TurnEvent 转发
  request, // ModelRequest
});
const result = await reader.read(v4Stream); // { text, reasoning, toolCalls, usage }
```

## 相关文档

- [AI SDK 流式 chunk 协议](../../docs/insights/ai-sdk-stream-chunk-protocols.md)
