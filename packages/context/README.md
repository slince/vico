# @vico/context

上下文洋葱模型处理器。

按优先级组合多个 `ContextProcessor`（系统提示词、Skill、记忆、RAG、工作区工具），把 Agent 运行时上下文装配成最终模型请求。

## 主要导出

- `ModelRequestContext` / `AgentRef` — 上下文模型
- `ContextProcessor` / `ProcessorPipeline` / `buildModelRequest` / `Priority` — 洋葱模型管道
- 处理器 — `SystemPromptProcessor` / `SkillProcessor` / `MemoryProcessor` / `RagProcessor` / `WorkspaceToolProcessor`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/model` / `@vico/thread` / `@vico/tool` | 模型请求、会话、工具上下文 |
| `@vico/memory` / `@vico/skill` / `@vico/rag` | 记忆、Skill、RAG 数据源 |
| `ai` | AI SDK 类型 |

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
