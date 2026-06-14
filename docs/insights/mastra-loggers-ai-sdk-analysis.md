# @mastra/loggers 与 @mastra/ai-sdk 分析

> 生成日期：2026-06-15

## @mastra/loggers

### 是什么

Mastra 框架的**日志传输器（transport）集合**，扩展 `@mastra/core` 的 `LoggerTransport` 类，提供可插拔的日志输出目标。

### 提供的 Transport

- **FileTransport** — 追加写入本地文件，支持按 `runId` 查询日志、自动流清理
- **UpstashTransport** — 批量写入 Upstash Redis，支持自动轮转（LTRIM）、失败重试、优雅关闭

### 项目现状

| 状态 | 说明 |
|------|------|
| 已安装版本 | `^1.1.2` |
| 引用次数 | **0**（代码中无任何导入） |
| 项目方案 | 使用 **pino**（`src/lib/logger.ts`），非 Mastra Logger |

### 结论

无价值。项目 Logger 层已绑定 pino，没有切换到 Mastra Logger 的计划。**建议移除该依赖。**

---

## @mastra/ai-sdk

### 是什么

Mastra 和 Vercel AI SDK 之间的**桥接层**。将 Mastra agent 输出转换为 AI SDK 兼容格式，让前端能用 `@ai-sdk/react` 的 `useChat()` 等 hooks。

### 提供的能力

- **`withMastra()` 包装器** — 给任意 AI SDK 模型注入 Mastra 能力（input/output processor、memory、content filtering），无需切换到完整 Mastra agent API
- **Chat Route Handler** — 将 Mastra agent 对话流转换为 AI SDK 格式
- **Workflow / Network Route Handler** — 将 Mastra workflow、agent network 执行事件流式输出为 AI SDK 兼容流
- **AI SDK v5 兼容** — 自定义数据组件、挂起/恢复支持

### 项目现状

| 状态 | 说明 |
|------|------|
| 已安装版本 | `^1.4.5` |
| 引用次数 | **0**（代码中无任何导入） |
| 项目方案 | 直接使用 `@ai-sdk/openai` 和 `@ai-sdk/anthropic` 创建模型实例（`model-bridge.ts`），前端用自建 SSE 消费 |

### 结论

当前无使用场景。项目前端通过自定义 SSE 流消费 agent 输出，不走 AI SDK React 的 `useChat()` 体系。**建议评估后移除。** 如果未来计划引入 `@ai-sdk/react` 的流式 UI 能力，再重新考虑。
