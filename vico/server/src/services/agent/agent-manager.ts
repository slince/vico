import {count, desc, eq} from 'drizzle-orm';
import {v4 as uuid} from 'uuid';
import {getDb, schema} from '../../db/db.js';
import {modelManager} from '../model/model-manager.js';
import {config} from '../../config.js';
import {
  type AgentDetail,
  type AgentRuntimeConfig,
  type BuiltinToolsConfig,
  type CreateAgentInput,
  createAgentSchema,
  replaceKnowledgeSchema,
  type UpdateAgentInput,
  updateAgentSchema,
} from './types.js';

const { agents } = schema;

class AgentManager {
  async countEnabled(): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(agents)
      .where(eq(agents.enabled, 1))
      .all();
    return row?.c ?? 0;
  }

  async count(): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(agents)
      .all();
    return row?.c ?? 0;
  }

  async list(): Promise<AgentDetail[]> {
    const db = getDb();
    const rows = await db.select().from(agents)
      .orderBy(desc(agents.updated_at))
      .all();

    return rows.map((a) => ({ ...a }) as AgentDetail);
  }

  async getById(id: string): Promise<AgentDetail | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(eq(agents.id, id))
      .get();

    if (!agent) return null;
    return { ...agent } as AgentDetail;
  }

  /**
   * 按 id 查询 Agent 名称。
   * agentId 为全局唯一 UUID，跨租户唯一，故无需 tenant 过滤。
   */
  async getName(agentId: string): Promise<string | undefined> {
    const db = getDb();
    const agent = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    return agent?.name;
  }

  async getAgentRuntimeConfig(agentId: string): Promise<AgentRuntimeConfig | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(eq(agents.id, agentId))
      .get();
    if (!agent) throw new Error('Agent not found');

    let model: AgentRuntimeConfig['model'] | null = null;
    if (agent.model_id) {
      model = await modelManager.getById(agent.model_id);
    }
    if (!model) throw new Error('未配置模型，请先在模型管理中至少添加一个模型');

    const instructions = agent.system_prompt || 'You are a helpful assistant.';

    let builtin_tools: BuiltinToolsConfig = {};
    try {
      builtin_tools = JSON.parse(agent.builtin_tools || '{}');
    } catch { /* use empty default */ }

    return {
      model,
      instructions,
      agent,
      workspace: config.workspace.base_path,
      builtin_tools,
    };
  }

  async create(input: unknown): Promise<AgentDetail> {
    const data = createAgentSchema.parse(input) as CreateAgentInput;
    const db = getDb();
    const id = uuid();
    const now = Date.now();

    await db.insert(agents).values({
      id,
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
    return (await this.getById(id))!;
  }

  async update(id: string, input: unknown): Promise<void> {
    const db = getDb();

    const existing = await db.select({ id: agents.id, is_default: agents.is_default }).from(agents)
      .where(eq(agents.id, id))
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
      .where(eq(agents.id, id))
      .run();
  }

  async remove(id: string): Promise<void> {
    const db = getDb();
    const agent = await db.select({ is_default: agents.is_default }).from(agents)
      .where(eq(agents.id, id))
      .get();
    if (!agent) return;
    if (agent.is_default === 1) {
      throw new Error('Cannot delete the default agent');
    }
    await db.delete(agents).where(eq(agents.id, id)).run();
  }

  async getDefault(): Promise<AgentDetail | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(eq(agents.is_default, 1))
      .get();
    if (!agent) return null;
    return this.getById(agent.id);
  }

  async replaceKnowledge(id: string, input: unknown): Promise<void> {
    const { kb_id, mode } = replaceKnowledgeSchema.parse(input);
    const db = getDb();

    await db.update(agents)
      .set({ kb_id: kb_id ?? null, updated_at: Date.now() })
      .where(eq(agents.id, id))
      .run();
  }
}

/** Agent 业务管理器单例 */
export const agentManager = new AgentManager();
