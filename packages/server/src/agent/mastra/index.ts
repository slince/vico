// Mastra 增强引擎入口
// 集成 4 个 Bridge + 3 个 Processor，基于 AI SDK v4 构建增强版 Agent 管道
//
// 注：Mastra v1.42 内部捆绑 AI SDK v5/v6，与项目使用的 AI SDK v4 不兼容。
// 当前使用 AI SDK v4 streamText 直接实现增强管道，保留 Bridge + Processor 架构。
// 待 Mastra 支持 AI SDK v4 后，可无缝切换为 Mastra Agent。

export { createMastraAgent } from './agent-factory.js';
export type { PipelineContext, EnhancedPipelineResult } from './agent-factory.js';
