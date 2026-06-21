import { eq, and, desc, count } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';
import { modelManager } from '../model/model-manager.js';
import {
  createAgentSchema,
  updateAgentSchema,
  replaceKnowledgeSchema,
  type CreateAgentInput,
  type UpdateAgentInput,
  type AgentDetail,
  type AgentRuntimeConfig,
} from './types.js';

const { agents } = schema;

class AgentManager {
  async countEnabled(tenantId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(agents)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.enabled, 1)))
      .all();
    return row?.c ?? 0;
  }

  async count(tenantId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .all();
    return row?.c ?? 0;
  }

  async list(tenantId: string): Promise<AgentDetail[]> {
    const db = getDb();
    const rows = await db.select().from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .orderBy(desc(agents.updated_at))
      .all();

    return rows.map((a) => ({ ...a }) as AgentDetail);
  }

  async getById(tenantId: string, id: string): Promise<AgentDetail | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .get();

    if (!agent) return null;
    return { ...agent } as AgentDetail;
  }

  async getAgentRuntimeConfig(tenantId: string, agentId: string): Promise<AgentRuntimeConfig | null> {
    const agent = await this.getById(tenantId, agentId);
    if (!agent) return null;

    let model: AgentRuntimeConfig['model'] | null = null;
    if (agent.model_id) {
      model = await modelManager.getById(tenantId, agent.model_id);
    }
    if (!model) {
      model = await modelManager.getDefault(tenantId);
    }
    if (!model) return null;

    const instructions = agent.system_prompt || 'You are a helpful assistant.';
    return { model, instructions, agent };
  }

  async create(tenantId: string, input: unknown): Promise<AgentDetail> {
    const data = createAgentSchema.parse(input) as CreateAgentInput;
    const db = getDb();
    const id = uuid();
    const now = Date.now();

    await db.insert(agents).values({
      id,
      tenant_id: tenantId,
      name: data.name,
      system_prompt: data.system_prompt,
      model_id: data.model_id,
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      max_steps: data.max_steps,
      rag_mode: data.rag_mode,
      builtin_tools: JSON.stringify(data.builtin_tools ?? {}),
      enabled: 1,
      created_at: now,
      updated_at: now,
    }).run();
    return (await this.getById(tenantId, id))!;
  }

  async update(tenantId: string, id: string, input: unknown): Promise<void> {
    const db = getDb();

    const existing = await db.select({ id: agents.id, is_default: agents.is_default }).from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .get();
    if (!existing) throw new Error('Agent not found');

    const parsed = updateAgentSchema.parse(input) as UpdateAgentInput;
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) updateData[k] = v;
    }

    if (existing.is_default === 1 && 'system_prompt' in updateData) {
      throw new Error('Cannot modify system prompt of the default agent');
    }
    if (existing.is_default === 1 && updateData.enabled === 0) {
      throw new Error('Cannot disable the default agent');
    }

    if (Object.keys(updateData).length === 0) return;

    if (updateData.builtin_tools !== undefined) {
      updateData.builtin_tools = JSON.stringify(updateData.builtin_tools);
    }

    updateData.updated_at = Date.now();
    await db.update(agents).set(updateData)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.id, id)))
      .run();
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const db = getDb();
    const agent = await db.select({ is_default: agents.is_default }).from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .get();
    if (!agent) return;
    if (agent.is_default === 1) {
      throw new Error('Cannot delete the default agent');
    }
    await db.delete(agents).where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId))).run();
  }

  async getDefault(tenantId: string): Promise<AgentDetail | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.is_default, 1)))
      .get();
    if (!agent) return null;
    return this.getById(tenantId, agent.id);
  }

  async replaceKnowledge(tenantId: string, id: string, input: unknown): Promise<void> {
    const { kb_id, mode } = replaceKnowledgeSchema.parse(input);
    const db = getDb();

    await db.update(agents)
      .set({ kb_id: kb_id ?? null, updated_at: Date.now() })
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .run();
  }
}

/** Agent 业务管理器单例 */
export const agentManager = new AgentManager();
