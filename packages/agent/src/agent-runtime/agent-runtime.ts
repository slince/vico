// @vico/agent - AgentRuntime: manages Agent lifecycle with LRU cache
import { Agent, type AgentFactory } from './types.js';
import type { AgentConfig } from '../contracts/agent.js';

export { Agent, type AgentFactory } from './types.js';

/** Agent 缓存条目 */
interface CacheEntry {
  agent: Agent;
  lastUsedAt: number;
}

/** AgentRuntime — LRU 缓存 + 动态 Agent 生命周期 */
export class AgentRuntime {
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
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        this.cache.delete(key);
      }
    }
  }

  async updateAgent(agentId: string, patch: Partial<AgentConfig>): Promise<Agent> {
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
