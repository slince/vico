// @vico/agent - AgentRuntime module type definitions
import type { AgentConfig } from '../contracts/agent.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';

/** Agent 实例 — 将配置与运行时 loop 组装在一起 */
export interface Agent {
  readonly config: AgentConfig;
  readonly loop: AgentLoop;
}

/** Agent 工厂函数 — 由外部注入，负责按配置组装 AgentLoop */
export type AgentFactory = (config: AgentConfig) => Promise<Agent>;
