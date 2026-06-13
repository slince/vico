/**
 * AgentToolCache — 按租户缓存用户自定义 Agent 转换后的 Mastra Tool 映射表。
 *
 * 首次获取时从 DB 懒加载构建。Agent CRUD 后通过 invalidate() 清除对应租户缓存。
 * 缓存的内容包括：
 *  - toolId → Tool 的映射，供 vicoMainAgent 的子 Agent 路由使用
 *  - Agent 能力描述文本，注入到 MainAgent 的 instructions 中帮助 LLM 判断路由
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db/db.js';
import { createAgentTool } from '../tools/agent-tool.factory.js';
import logger from '../../../lib/logger.js';

const { agents } = schema;

/**
 * Agent Tool 缓存管理器。
 *
 * 按租户缓存用户自定义 Agent 转换后的 Mastra Tool 映射表。
 * 首次获取时懒加载从 DB 构建。Agent CRUD 后通过 invalidate() 清除。
 */
class AgentToolCache {
  /** tenantId → Map<toolId, Tool> */
  private cache: Map<string, Map<string, any>> = new Map();

  /** tenantId → Agent 能力描述文本 */
  private descCache: Map<string, string> = new Map();

  /**
   * 获取租户可用的 Agent Tool 映射表（toolId → Tool）。
   *
   * @param tenantId - 租户 ID
   * @returns toolId 到 Tool 实例的映射对象
   */
  async getToolsForTenant(tenantId: string): Promise<Record<string, any>> {
    if (!this.cache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    const tools: Record<string, any> = {};
    const tenantTools = this.cache.get(tenantId)!;
    for (const [id, tool] of tenantTools) {
      tools[id] = tool;
    }
    return tools;
  }

  /**
   * 获取租户所有 Agent 的能力描述文本。
   *
   * 用于注入到 vicoMainAgent 的 instructions 中，帮助 LLM 判断
   * 应该将用户请求路由到哪个子 Agent。
   *
   * @param tenantId - 租户 ID
   * @returns Agent 能力描述的 Markdown 文本
   */
  async getAgentDescriptions(tenantId: string): Promise<string> {
    if (!this.descCache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    return this.descCache.get(tenantId) || '';
  }

  /**
   * 从 DB 重建租户的 Tool 列表和能力描述。
   *
   * 查询租户所有 Agent 记录，为每个 Agent 调用 createAgentTool 创建 Tool，
   * 同时构建描述文本。失败的单个 Agent 不会阻塞整体构建。
   *
   * @param tenantId - 租户 ID
   */
  private async rebuildForTenant(tenantId: string): Promise<void> {
    const db = getDb();
    const agentRows = await db
      .select()
      .from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .all();

    const toolMap = new Map<string, any>();
    const descriptions: string[] = [];

    for (const row of agentRows) {
      try {
        const tool = createAgentTool(row as any, tenantId);
        toolMap.set(`agent_${row.id}`, tool);
        descriptions.push(
          `- **${row.name}** (agent_${row.id}): ${row.description || '无描述'}`,
        );
      } catch (err) {
        logger.error(
          { err, agentId: row.id },
          'Failed to create agent tool',
        );
      }
    }

    this.cache.set(tenantId, toolMap);
    this.descCache.set(tenantId, descriptions.join('\n'));
    logger.info(
      { tenantId, count: toolMap.size },
      'Agent tool cache rebuilt',
    );
  }

  /**
   * 清除指定租户的缓存。
   *
   * Agent CRUD（创建/更新/删除）后必须调用此方法，
   * 确保下次获取时会从 DB 重新构建 Tool 列表。
   *
   * @param tenantId - 租户 ID
   */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.descCache.delete(tenantId);
    logger.info({ tenantId }, 'Agent tool cache invalidated');
  }

  /** 清除所有租户的缓存 */
  invalidateAll(): void {
    this.cache.clear();
    this.descCache.clear();
    logger.info('All agent tool caches invalidated');
  }
}

export const agentToolCache = new AgentToolCache();
