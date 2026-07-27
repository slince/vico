// @vico/core - AgentRuntime: manages Agent lifecycle with LRU cache
import type {ToolSet} from 'ai';
import {Agent} from './agent.js';

/** Agent 缓存条目 */
interface AgentEntry {
  agent: Agent<ToolSet>;
  lastUsedAt: number;
}

/** AgentRuntime — 负责 Agent 的注册、缓存和 LRU 淘汰 */
export class AgentRuntime {
  private cache: Map<string, AgentEntry> = new Map();
  private maxCached: number;

  constructor(maxCached = 50) {
    this.maxCached = maxCached;
  }

  /**
   * 注册 Agent 并纳入缓存。
   *
   * @param agent - 要注册的 Agent 实例
   */
  register(agent: Agent<ToolSet>): void {
    const key = agent.id;
    const existing = this.cache.get(key);
    if (existing) {
      existing.agent = agent;
      existing.lastUsedAt = Date.now();
      return;
    }

    this.cache.set(key, { agent, lastUsedAt: Date.now() });
    this.evictIfNeeded();
  }

  /**
   * 销毁（移除）Agent。
   *
   * @param agentId - 要移除的 Agent ID
   */
  destroy(agentId: string): void {
    this.cache.delete(agentId);
  }

  getAgent(agentId: string): Agent<ToolSet> | undefined {
    const entry = this.cache.get(agentId);
    if (entry) {
      entry.lastUsedAt = Date.now();
      return entry.agent;
    }
    return undefined;
  }

  listAgents(): Agent<ToolSet>[] {
    const result: Agent<ToolSet>[] = [];
    for (const entry of this.cache.values()) {
      result.push(entry.agent);
    }
    return result;
  }

  /**
   * LRU 淘汰：超过 maxCached 时移除最久未使用的条目。
   */
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
