/**
 * Agent 实例获取 — 薄封装：转发到容器装配的 AgentFactory。
 *
 * 服务端各处可通过 getAgent(id) 直接拿到可交互的 agent 对象；
 * 实际构建逻辑已下沉到 lib/agent-factory.ts（依赖注入）。
 */
import type { Agent } from '@vico/agent';
import { getContainer } from '../container.js';

/**
 * 获取或注册 Vico Agent 实例（不存在则创建，全局缓存）。
 */
export async function getAgent(agentId: string): Promise<Agent> {
  return getContainer().get('agentFactory').create(agentId);
}
