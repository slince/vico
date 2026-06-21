import { eq, and, desc, inArray, count } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';
import { agentToolStore } from '../../agent/tools/agent-tool-store.js';
import { modelManager } from '../model/model-manager.js';
import { skillManager } from '../../skill/manager.js';
import {
  createAgentSchema,
  updateAgentSchema,
  replaceSkillsSchema,
  replaceKnowledgeSchema,
  type CreateAgentInput,
  type UpdateAgentInput,
  type AgentRow,
  type AgentDetail,
  type AgentRuntimeConfig,
} from './types.js';

const { agents, agent_skills } = schema;

/**
 * Agent 业务管理器。
 *
 * 封装 Agent CRUD、关联表操作和缓存失效逻辑。
 * 模块级单例，通过 `agentManager` 导出。
 */
class AgentManager {
  // ── 查询 ──

  /**
   * 获取租户下启用状态的 Agent 总数。
   */
  async countEnabled(tenantId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(agents)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.enabled, 1)))
      .all();
    return row?.c ?? 0;
  }

  /**
   * 获取租户下 Agent 总数（含禁用）。
   */
  async count(tenantId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .all();
    return row?.c ?? 0;
  }

  /**
   * 获取租户下所有 Agent 列表，附带关联的 skill_names 和 kb_ids。
   * 使用批量查询消除 N+1 问题。
   */
  async list(tenantId: string): Promise<AgentDetail[]> {
    const db = getDb();
    const rows = await db.select().from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .orderBy(desc(agents.updated_at))
      .all();

    if (rows.length === 0) return [];

    const agentIds = rows.map((a) => a.id);

    // 批量查询关联数据（仅 1 次查询，替代 N+1）
    const allSkills = await db.select({
      agent_id: agent_skills.agent_id,
      skill_name: agent_skills.skill_name,
      config: agent_skills.config,
    })
      .from(agent_skills)
      .where(inArray(agent_skills.agent_id, agentIds))
      .all();

    // 建立 agentId → 关联数据 的映射
    const skillsMap = new Map<string, { skill_name: string; config: string }[]>();
    for (const s of allSkills) {
      if (!skillsMap.has(s.agent_id)) skillsMap.set(s.agent_id, []);
      skillsMap.get(s.agent_id)!.push({ skill_name: s.skill_name, config: s.config });
    }

    return rows.map((a) => {
      const skills = skillsMap.get(a.id) || [];
      return {
        ...a,
        skills,
        skill_names: skills.map((s) => s.skill_name),
      };
    });
  }

  /**
   * 按 ID 获取单个 Agent 详情，含关联的 skills 数据。
   * 不存在时返回 null。
   */
  async getById(tenantId: string, id: string): Promise<AgentDetail | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .get();

    if (!agent) return null;

    const skills = await db.select({
      skill_name: agent_skills.skill_name,
      config: agent_skills.config,
    }).from(agent_skills).where(eq(agent_skills.agent_id, id)).all();

    return {
      ...agent,
      skills,
      skill_names: skills.map((s) => s.skill_name),
    };
  }

  /**
   * 获取 Agent 运行时配置。
   *
   * 一次性解析 Agent 执行所需的所有参数：已解析的模型实例、
   * 编译后的基础系统指令（system_prompt + Skill 提示词）、执行选项。
   * 调用方可将结果注入 requestContext，供 agentProxy 同步读取。
   *
   * @param tenantId - 租户 ID
   * @param agentId - Agent ID
   * @returns 运行时配置，Agent 不存在或模型解析失败时返回 null
   */
  async getAgentRuntimeConfig(tenantId: string, agentId: string): Promise<AgentRuntimeConfig | null> {
    const agent = await this.getById(tenantId, agentId);
    if (!agent) return null;

    // 解析模型配置
    let model: AgentRuntimeConfig['model'] | null = null;
    if (agent.model_id) {
      model = await modelManager.getById(tenantId, agent.model_id);
    }
    if (!model) {
      model = await modelManager.getDefault(tenantId);
    }
    if (!model) return null;

    // 编译基础 instructions（system_prompt + Skill 提示词）
    let instructions = agent.system_prompt || 'You are a helpful assistant.';
    try {
      const skillPrompts = await skillManager.getPromptForAgent(agentId);
      if (skillPrompts) {
        instructions += '\n\n## 技能指南\n' + skillPrompts;
      }
    } catch {
      // Skill 提示词加载失败时静默跳过
    }

    return { model, instructions, agent };
  }

  // ── 变更 ──

  /**
   * 创建新 Agent。
   * 输入经过 Zod 校验，自动应用默认值。
   */
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

    agentToolStore.invalidate(tenantId);
    return (await this.getById(tenantId, id))!;
  }

  /**
   * 更新 Agent 字段。
   * 仅更新 body 中提供的字段（whitelist 由 Zod schema 保证），至少需要一个字段。
   */
  async update(tenantId: string, id: string, input: unknown): Promise<void> {
    const db = getDb();

    // 存在性检查
    const existing = await db.select({ id: agents.id, is_default: agents.is_default }).from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .get();
    if (!existing) throw new Error('Agent not found');

    // Zod 校验 + 过滤 undefined
    const parsed = updateAgentSchema.parse(input) as UpdateAgentInput;
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) updateData[k] = v;
    }

    // 默认 Agent 不允许修改 system_prompt
    if (existing.is_default === 1 && 'system_prompt' in updateData) {
      throw new Error('Cannot modify system prompt of the default agent');
    }

    // 默认 Agent 不允许禁用
    if (existing.is_default === 1 && updateData.enabled === 0) {
      throw new Error('Cannot disable the default agent');
    }

    if (Object.keys(updateData).length === 0) return;

    // builtin_tools 对象序列化为 JSON 字符串存入 DB
    if (updateData.builtin_tools !== undefined) {
      updateData.builtin_tools = JSON.stringify(updateData.builtin_tools);
    }

    updateData.updated_at = Date.now();
    await db.update(agents).set(updateData)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.id, id)))
      .run();

    agentToolStore.invalidate(tenantId);
  }

  /**
   * 删除 Agent，同时级联删除关联的 skills。
   * 默认 Agent（is_default=1）不可删除。
   */
  async remove(tenantId: string, id: string): Promise<void> {
    const db = getDb();
    const agent = await db.select({ is_default: agents.is_default }).from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .get();
    if (!agent) return;
    if (agent.is_default === 1) {
      throw new Error('Cannot delete the default agent');
    }
    await db.delete(agent_skills).where(eq(agent_skills.agent_id, id)).run();
    await db.delete(agents).where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId))).run();
    agentToolStore.invalidate(tenantId);
  }

  /**
   * 获取租户的默认 Agent（is_default=1），不存在时返回 null。
   */
  async getDefault(tenantId: string): Promise<AgentDetail | null> {
    const db = getDb();
    const agent = await db.select().from(agents)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.is_default, 1)))
      .get();
    if (!agent) return null;
    return this.getById(tenantId, agent.id);
  }

  /**
   * 替换 Agent 绑定的 Skills（全量替换策略）。
   */
  async replaceSkills(tenantId: string, id: string, input: unknown): Promise<void> {
    const { skills } = replaceSkillsSchema.parse(input);
    const db = getDb();

    await db.delete(agent_skills).where(eq(agent_skills.agent_id, id)).run();
    for (const s of skills) {
      await db.insert(agent_skills).values({
        agent_id: id,
        skill_name: s.skill_name,
        config: JSON.stringify(s.config || {}),
      }).onConflictDoUpdate({
        target: [agent_skills.agent_id, agent_skills.skill_name],
        set: { config: JSON.stringify(s.config || {}) },
      }).run();
    }
    agentToolStore.invalidate(tenantId);
  }

  /**
   * 设置 Agent 绑定的知识库（单 KB）。
   * kb_id 为 null 时解绑。
   */
  async replaceKnowledge(tenantId: string, id: string, input: unknown): Promise<void> {
    const { kb_id, mode } = replaceKnowledgeSchema.parse(input);
    const db = getDb();

    await db.update(agents)
      .set({ kb_id: kb_id ?? null, updated_at: Date.now() })
      .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
      .run();

    agentToolStore.invalidate(tenantId);
  }
}

/** Agent 业务管理器单例 */
export const agentManager = new AgentManager();
