# @vico/agent

Agent 编排核心。

Agent 运行时与默认 LoopAgent 实现，装配模型、工具、记忆、上下文处理器，驱动多轮工具调用循环。

## 快速使用

```ts
import { createAgent } from '@vico/agent';

const agent = await createAgent({
  id: 'demo',
  name: 'Demo Agent',
  systemPrompt: 'You are a helpful assistant.',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY!,
  },
  maxSteps: 5,
  workspace: process.cwd(), // 工具执行的默认工作目录
});

// 订阅 turn 事件
agent.on('text-delta', (e) => console.log(e.content));

// 创建会话并发起对话
const thread = await agent.createThread({ title: '新会话', userId: 'user-1' });
const result = await agent.invoke('Hello'); // 非流式
const output = await agent.stream('Hello'); // 流式（TurnOutput）
```

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
