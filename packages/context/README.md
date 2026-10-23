# @vico/context

上下文洋葱模型处理器。

按优先级组合多个 `ContextProcessor`（系统提示词、Skill、记忆、RAG、工作区工具），把 Agent 运行时上下文装配成最终模型请求。

## 快速使用

```ts
import {
  ModelRequestContext,
  ProcessorPipeline,
  SystemPromptProcessor,
  buildModelRequest,
} from '@vico/context';

// 可变上下文，穿过洋葱各层
const ctx = new ModelRequestContext({
  agent: {
    id: 'a1',
    name: 'Demo',
    systemPrompt: 'You are helpful.',
    temperature: 0.7,
    maxSteps: 10,
  },
  userMessages: [{ role: 'user', content: 'Hello' }],
  systemPrompt: 'You are helpful.',
});

// 洋葱管道：enter 按优先级升序执行，leave 逆序执行
const pipeline = new ProcessorPipeline([new SystemPromptProcessor()]);
await pipeline.enter(ctx);

ctx.appendSystemPrompt('你可以使用工作区工具。');

// 提取 streamText 所需参数
const request = buildModelRequest(ctx); // { system, messages, tools, maxTokens, temperature }
```

