// @vico/agent - AgentRuntime module type definitions
import type { AgentConfig } from '../contracts/agent.js';
import type { AgentLoop } from '../agent-loop/types.js';

/** Agent 实例 — 将配置与运行时 loop 组装在一起 */
export interface Agent {
  readonly config: AgentConfig;
  readonly loop: AgentLoop;
}

/** Agent 工厂函数 — 由外部注入，负责按配置组装 AgentLoop */
export type AgentFactory = (config: AgentConfig) => Promise<Agent>;

/** Agent 运行时容器端口 */
export interface AgentRuntime {
  /** 创建（或返回已缓存的）Agent 实例 */
  createAgent(config: AgentConfig): Promise<Agent>;

  /** 销毁 Agent，从缓存中移除 */
  destroyAgent(agentId: string): Promise<void>;

  /** 部分更新 Agent 配置并重建实例 */
  updateAgent(agentId: string, config: Partial<AgentConfig>): Promise<Agent>;

  /** 根据 agentId 查找缓存的 Agent，未命中返回 undefined */
  getAgent(agentId: string): Agent | undefined;

  /** 列出指定租户下的所有 Agent 实例 */
  listAgents(tenantId: string): Agent[];

  /** 销毁旧实例并用原配置重建 */
  reloadAgent(agentId: string): Promise<Agent>;

  /** 检查 Agent 是否已缓存且可用 */
  isHealthy(agentId: string): boolean;
}
