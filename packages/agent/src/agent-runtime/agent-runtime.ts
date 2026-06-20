// @vico/agent - AgentRuntime: manages Agent lifecycle with LRU cache
import type { AgentConfig } from '../contracts/agent.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';

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

/** Agent 缓存条目 */
interface CacheEntry {
  agent: Agent;
  lastUsedAt: number;
}

/** AgentRuntime 默认实现 — LRU 缓存 + 动态 Agent 生命周期 */
export class AgentRuntimeImpl implements AgentRuntime {
  private cache: Map<string, CacheEntry> = new Map();
  private factory: AgentFactory;
  private maxCached: number;

  constructor(factory: AgentFactory, maxCached = 50) {
    this.factory = factory;
    this.maxCached = maxCached;
  }

  /** 缓存键 = tenant_id + agent_id */
  private cacheKey(config: AgentConfig): string {
    return `${config.tenantId}:${config.id}`;
  }

  async createAgent(config: AgentConfig): Promise<Agent> {
    const key = this.cacheKey(config);
    const existing = this.cache.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.agent;
    }

    const agent = await this.factory(config);
    this.cache.set(key, { agent, lastUsedAt: Date.now() });
    this.evictIfNeeded();
    return agent;
  }

  async destroyAgent(agentId: string): Promise<void> {
    // 按 agentId 查找所有租户的缓存
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        this.cache.delete(key);
      }
    }
  }

  async updateAgent(agentId: string, patch: Partial<AgentConfig>): Promise<Agent> {
    // 找到旧 agent，merge 配置后重建
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        const newConfig = { ...entry.agent.config, ...patch };
        this.cache.delete(key);
        return this.createAgent(newConfig);
      }
    }
    throw new Error(`Agent ${agentId} not found in cache`);
  }

  getAgent(agentId: string): Agent | undefined {
    for (const entry of this.cache.values()) {
      if (entry.agent.config.id === agentId) {
        entry.lastUsedAt = Date.now();
        return entry.agent;
      }
    }
    return undefined;
  }

  listAgents(tenantId: string): Agent[] {
    const result: Agent[] = [];
    for (const [key, entry] of this.cache) {
      if (key.startsWith(`${tenantId}:`)) {
        result.push(entry.agent);
      }
    }
    return result;
  }

  async reloadAgent(agentId: string): Promise<Agent> {
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        this.cache.delete(key);
        return this.createAgent(entry.agent.config);
      }
    }
    throw new Error(`Agent ${agentId} not found`);
  }

  isHealthy(agentId: string): boolean {
    return this.getAgent(agentId) !== undefined;
  }

  /** LRU 淘汰：超过 maxCached 时移除最久未使用的条目 */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxCached) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }
}
