import type { AgentConfig, AgentContext, Message } from './agent.js';

/**
 * AgentRuntime — 动态 Agent 容器。
 * 替代 Mastra IoC 的核心模块：运行时按需创建/销毁/更新 Agent 实例。
 */
export interface AgentRuntime {
  /**
   * 从配置创建 Agent 实例并注册到容器。
   * 如果已存在同 ID 的 Agent，先销毁旧的再创建新的。
   */
  createAgent(config: AgentConfig): Promise<Agent>;

  /**
   * 销毁 Agent 实例，释放相关资源。
   */
  destroyAgent(agentId: string): Promise<void>;

  /**
   * 部分更新 Agent 配置（热更新）。
   * 传入的字段合并到现有配置，未传入的保持不变。
   */
  updateAgent(agentId: string, patch: Partial<AgentConfig>): Promise<Agent>;

  /**
   * 获取已注册的 Agent 实例。
   * 不存在时返回 undefined。
   */
  getAgent(agentId: string): Agent | undefined;

  /**
   * 列出指定租户下的所有 Agent。
   */
  listAgents(tenantId: string): Agent[];

  /**
   * 重新加载 Agent 配置（从外部存储重新读取并更新实例）。
   */
  reloadAgent(agentId: string): Promise<Agent>;

  /**
   * 检查 Agent 实例是否健康。
   */
  isHealthy(agentId: string): boolean;
}

/**
 * Agent 实例 — 框架中的 Agent 运行时表示。
 * 被 AgentRuntime 管理，暴露执行能力。
 */
export interface Agent {
  /** 静态配置 */
  readonly config: AgentConfig;

  /** 运行一个对话 Turn */
  runTurn(context: AgentContext, signal: AbortSignal): Promise<TurnResult>;

  /** 中断当前正在执行的 Turn */
  interrupt(): void;

  /** 引导：注入修正文本到下一个 modelStep */
  steer(text: string): void;
}
export type TurnResult = {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  messages: Message[];
};
