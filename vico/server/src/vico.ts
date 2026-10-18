/**
 * Vico 框架薄适配层 — 暴露全局 agent 服务与 Hono app 实例。
 *
 * 替代已废弃的 `Vico` 类：底层依赖（memory/thread/checkpoint/skills/runtime）
 * 均由 @vico/boot 容器装配，这里只做 AgentConfig 的全局 fallback 与 LRU 注册。
 */
import { createAgent } from '@vico/agent';
import type { Agent, AgentConfig } from '@vico/agent';
import type { Skill } from '@vico/skill';
import type { ThreadStore } from '@vico/thread';
import { createApp } from './app.js';
import { getContainer } from './container.js';

/** Hono app 实例（含 WebSocket 路由注册） */
export const app = createApp();

/** 列出当前可用的全部 Skill（来自 boot 容器的 skills 异步工厂） */
export async function listSkills(): Promise<Skill[]> {
  return getContainer().resolveAsync('skills');
}

/**
 * 获取或注册 Agent 实例（不存在则创建，全局 LRU 缓存）。
 *
 * AgentConfig 未显式指定 tools/memory/thread/checkpointStore/events 时，
 * fallback 到 boot 容器装配的全局实例，保持与旧 Vico 类一致的语义。
 */
export async function createIfAbsent(agentId: string, factory: () => Promise<AgentConfig>): Promise<Agent> {
  const c = getContainer();
  const runtime = c.resolve('agentRuntime');

  const existing = runtime.getAgent(agentId);
  if (existing) return existing;

  const config = await factory();
  const agent = await createAgent({
    ...config,
    tools: config.tools ?? [c.resolve('weatherTool')],
    memory: config.memory ?? c.resolve('memory'),
    thread: config.thread ?? c.resolve('thread'),
    checkpointStore: config.checkpointStore ?? c.resolve('checkpointStore'),
    events: config.events ?? c.resolve('events'),
  });
  runtime.register(agent);
  return agent;
}

/** 获取 boot 容器装配的全局 ThreadStore（thread 后端由 storage 配置决定） */
export function getThreadStore(): ThreadStore {
  return getContainer().resolve('thread');
}
