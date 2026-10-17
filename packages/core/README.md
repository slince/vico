# @vico/core

Vico 聚合壳：re-export 全部 13 个领域子包，消费方零改动入口。

新代码建议直接依赖细粒度子包（如 `@vico/tool` / `@vico/memory`），本包仅作为统一入口保留。

## 快速使用

```ts
import { Vico, MemoryStore } from '@vico/core';

// 一键装配所有 Agent 服务
const vico = new Vico({
  memory: new MemoryStore(),
});

const agent = await vico.createAgent({
  id: 'demo',
  name: 'Demo Agent',
  systemPrompt: 'You are a helpful assistant.',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY!,
  },
});

const result = await agent.invoke('Hello');

// 已注册 Agent 可从 Runtime 获取
const cached = vico.runtime.getAgent('demo');
```

## 相关文档

- [拆分方案](SPLIT-PLAN.md)
- [依赖图](DEPENDENCIES.md)
