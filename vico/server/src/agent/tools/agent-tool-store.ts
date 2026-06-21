/**
 * AgentToolStore — 按租户缓存用户自定义 Agent 的委托工具。
 *
 * 不再使用 Mastra Tool 类型，改为 Vico Tool 接口。
 */
import type { Tool } from '@vico/agent';
import { agentManager } from '../../services/agent/agent-manager.js';
import { createAgentTool } from './agent-tool.factory.js';
import logger from '../../lib/logger.js';

class AgentToolStore {
  private cache: Map<string, Map<string, Tool>> = new Map();
  private descCache: Map<string, string> = new Map();

  async getToolsForTenant(tenantId: string): Promise<Record<string, Tool>> {
    if (!this.cache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    const tools: Record<string, Tool> = {};
    for (const [id, tool] of this.cache.get(tenantId)!) {
      tools[id] = tool;
    }
    return tools;
  }

  async getAgentDescriptions(tenantId: string): Promise<string> {
    if (!this.descCache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    return this.descCache.get(tenantId) || '';
  }

  private async rebuildForTenant(tenantId: string): Promise<void> {
    const agentRows = await agentManager.list(tenantId);
    const toolMap = new Map<string, Tool>();
    const descriptions: string[] = [];

    for (const row of agentRows) {
      if (row.is_default === 1) continue;
      try {
        const tool = createAgentTool(row, tenantId);
        toolMap.set(`agent_${row.id}`, tool);
        descriptions.push(`- **${row.name}** (agent_${row.id})`);
      } catch (err) {
        logger.error({ err, agentId: row.id }, 'Failed to create agent tool');
      }
    }

    this.cache.set(tenantId, toolMap);
    this.descCache.set(tenantId, descriptions.join('\n'));
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.descCache.delete(tenantId);
  }

  invalidateAll(): void {
    this.cache.clear();
    this.descCache.clear();
  }
}

export const agentToolStore = new AgentToolStore();
