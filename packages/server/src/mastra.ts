import {Mastra} from '@mastra/core';
import {PinoLogger} from '@mastra/loggers';
import {MastraServer} from '@mastra/hono';
import {mainAgent} from './agent/agents/main.agent.js';
import {agentProxy} from './agent/agents/agent-proxy.agent.js';
import {getMemory, getStorage} from './agent/memory-setup.js';
import {getObservabilityConfig} from './agent/observability/config.js';
import {createApp} from './app.js';

/**
 * Mastra 实例 — 全局单例。
 *
 * 预注册两个 Agent：
 * - mainAgent: 通用任务路由调度，负责分析意图并分派给专业 Agent
 * - agentProxy: 配置驱动的 Agent 代理模板，运行时通过 RunContext 动态注入配置
 *
 * 使用 LibSQLStore 作为持久化存储后端，为 Memory 的消息存储与召回提供支持。
 * 同时启用 Observability 观测性配置，通过 MastraStorageExporter 将遥测数据
 * 自动写入同一 LibSQL 存储后端。
 */
export const mastra = new Mastra({
  agents: {
    mainAgent,
    agentProxy,
  },
  storage: getStorage(),
  logger: new PinoLogger({
    name: 'Vico',
    level: 'info',
  }),
  memory: {
    memory: getMemory(),
  },
  observability: getObservabilityConfig(),
});

/** 创建 Hono app 实例，包含所有现有中间件和路由 */
export const app = createApp();

/**
 * MastraServer — @mastra/hono 集成适配器。
 *
 * 负责：
 * - 注入 Mastra Context 中间件（RequestContext + ToolsInput + AbortSignal 注入到 Hono context）
 * - 自动注册 Agent 流式端点（/api/mastra/agents/:id/chat 等内建路由）
 * - 注册自定义 API 路由（若通过 registerApiRoute() 定义）
 * - 流式响应处理（SSE 格式）
 *
 * MastraServer 构造函数接收 `app` 作为必需参数，内部通过
 * `mastra.setMastraServer(this)` 将自身注册到 Mastra 实例。
 *
 * `init()` 按顺序执行：context 中间件 → auth 中间件 → 日志中间件 →
 * EE 许可证校验（无 RBAC/FGA 配置时跳过）→ 自定义路由 → 内建路由。
 */
export const server = new MastraServer({ app, mastra });

// 初始化 MastraServer：注册所有中间件和路由
await server.init();

export default mastra;
