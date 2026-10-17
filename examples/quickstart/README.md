# vico-quickstart

Vico Agent Framework 快速上手示例。

使用内置 mock 模型（无需 API Key）演示 `Vico` 容器的装配与一键对话。

## 运行

```bash
pnpm --filter vico-quickstart start
# 或
cd examples/quickstart && pnpm start
```

## 内容

- 用 `FakeModelClient` 模拟 LLM 响应并自动调用 `echo` 工具
- 演示 `Vico` 装配（Skill + Memory + ModelFactory）、Agent 创建与 `invoke` 对话

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/core` | 聚合入口 |
