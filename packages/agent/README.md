# @vico/agent

Agent 编排核心。

Agent 运行时与默认 LoopAgent 实现，装配模型、工具、记忆、上下文处理器，驱动多轮工具调用循环；提供 Vico 容器与 delegate 工具。

## 主要导出

- `createAgent` / `Agent` / `AgentOptions` / `CreateThreadOptions` / `AgentConfig` — Agent 定义
- `AgentRuntime` — 运行时
- `LoopAgent` / `LoopAgentOptions` / `RunOptions` / `TurnResult` — 默认循环实现
- `Vico` / `VicoOptions` — 一键装配容器（Skill + Memory + Model）
- `createDelegateTool` — 创建子 agent 的 delegate 工具
- `collectTurnResult` / `normalizeUserMessage` / `TurnOutput` / `LanguageModelFactory` — 工具函数与类型

## 依赖

依赖 L0–L4 全部域包（types / events / model / thread / stream / tool / skill / checkpoint / compaction / memory / context），是编排收口层——没有任何包反向依赖它（运行时）。

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
