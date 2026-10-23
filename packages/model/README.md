# @vico/model

模型接入层：语言模型工厂、ModelClient、消息工具。

统一 Anthropic / OpenAI 等 provider，为上层提供 `createLanguageModel` 工厂与 `ModelClient` 抽象。

## 快速使用

```ts
import { createLanguageModel, ModelClient } from '@vico/model';

// 1. 按配置解析 LanguageModelV4
const model = createLanguageModel({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  maxOutputTokens: 4096,
});

// 2. 包装为 ModelClient 发起流式调用
const client = new ModelClient(model);
const { readText } = await client.stream({
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: myTools, // @vico/tool 的 Tool[]，内部转为 provider 工具格式
});

// 3. 消费流拿到完整文本（与 stream 二选一）
const text = await readText();
```

## 相关文档

- [模型设置说明](../../docs/insights/model-settings-advanced-options.md)
