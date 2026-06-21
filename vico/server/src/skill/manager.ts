/**
 * Skill 管理器 — 桥接 @vico/agent Skill 发现与 DB 安装管理。
 *
 * 负责：
 * - 从文件系统扫描可用 Skill（通过 Vico SkillManager）
 * - 管理 installed_skills 表（租户级安装/卸载）
 * - 管理 agent_skills 表（Agent-Skill 绑定）
 * - 为 Agent 提供编译后的提示词 + 工具定义/实现
 */
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { vico } from '../vico.js';
import { getDb, schema } from '../db/db.js';
import logger from '../lib/logger.js';
import type { Skill } from '@vico/agent';

const { installed_skills, agent_skills } = schema;

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  path: string;
  source: string;
  license?: string;
  compatibility?: string;
  userInvocable: boolean;
}

export interface InstalledSkill {
  id: string;
  tenant_id: string;
  skill_name: string;
  display_name: string;
  version: string;
  config: string;
  enabled: number;
  installed_at: number;
}

export interface SkillToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface SkillToolImpl {
  definition: { name: string };
  handler: (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
}

class SkillManagerService {
  /** 获取 Vico 的 SkillManager 实例（文件系统发现） */
  private vsm() {
    return vico.getSkillManager();
  }

  /** 将 Vico Skill 转为前端展示用的 manifest */
  private toManifest(s: Skill): SkillManifest {
    return {
      name: s.name,
      description: s.description,
      path: s.path,
      source: s.source,
      license: s.license,
      compatibility: s.compatibility,
      userInvocable: s.userInvocable,
    };
  }

  // ── 发现（来自文件系统） ──

  /** 列出所有已发现 Skill 的 manifest */
  getAllManifests(): SkillManifest[] {
    return this.vsm().listAll().map((s) => this.toManifest(s));
  }

  /** 按名称获取单个 Skill manifest */
  getManifest(name: string): SkillManifest | undefined {
    const skill = this.vsm().get(name);
    return skill ? this.toManifest(skill) : undefined;
  }

  // ── 安装管理（DB 操作） ──

  /** 获取租户所有已安装 Skill */
  async getInstalledSkills(tenantId: string): Promise<InstalledSkill[]> {
    const db = getDb();
    const rows = await db.select().from(installed_skills)
      .where(eq(installed_skills.tenant_id, tenantId))
      .all();
    return rows as unknown as InstalledSkill[];
  }

  /** 安装 Skill 到租户 */
  async installSkill(tenantId: string, skillName: string, config: Record<string, unknown>): Promise<InstalledSkill> {
    const manifest = this.getManifest(skillName);
    if (!manifest) throw new Error(`Skill "${skillName}" not found`);

    const db = getDb();
    const id = uuid();
    const now = Date.now();

    await db.insert(installed_skills).values({
      id,
      tenant_id: tenantId,
      skill_name: skillName,
      display_name: manifest.description || skillName,
      version: manifest.version || '1.0.0',
      config: JSON.stringify(config),
      enabled: 1,
      installed_at: now,
    }).run();

    return { id, tenant_id: tenantId, skill_name: skillName, display_name: manifest.description, version: manifest.version || '1.0.0', config: JSON.stringify(config), enabled: 1, installed_at: now };
  }

  /** 更新 Skill 配置 */
  async updateSkillConfig(tenantId: string, name: string, config: Record<string, unknown>): Promise<void> {
    const db = getDb();
    await db.update(installed_skills)
      .set({ config: JSON.stringify(config) })
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, name)))
      .run();
  }

  /** 切换 Skill 启用状态 */
  async toggleSkill(tenantId: string, name: string, enabled: boolean): Promise<void> {
    const db = getDb();
    await db.update(installed_skills)
      .set({ enabled: enabled ? 1 : 0 })
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, name)))
      .run();
  }

  /** 卸载 Skill */
  async uninstallSkill(tenantId: string, name: string): Promise<void> {
    const db = getDb();
    await db.delete(agent_skills).where(eq(agent_skills.skill_name, name)).run();
    await db.delete(installed_skills)
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, name)))
      .run();
  }

  /** 统计租户启用的 Skill 数量 */
  async countEnabled(tenantId: string): Promise<number> {
    const db = getDb();
    const rows = await db.select().from(installed_skills)
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.enabled, 1)))
      .all();
    return rows.length;
  }

  // ── Agent-Skill 桥接 ──

  /** 获取 Agent 绑定的 Skill 工具定义（用于 ToolBroker 注册） */
  async getToolDefsForAgent(agentId: string): Promise<SkillToolDef[]> {
    const db = getDb();
    const bindings = await db.select({ skill_name: agent_skills.skill_name })
      .from(agent_skills)
      .where(eq(agent_skills.agent_id, agentId))
      .all();

    if (bindings.length === 0) return [];

    const defs: SkillToolDef[] = [];
    for (const b of bindings) {
      const skill = this.vsm().get(b.skill_name);
      if (!skill) continue;

      // Vico Skill 的 instructions 中包含工具注册信息（YAML frontmatter）
      // 工具参数从 tools.ts 中获取
      try {
        const tools = await this.loadToolDefsFromSkill(skill);
        defs.push(...tools);
      } catch (err) {
        logger.warn({ skillName: b.skill_name, err }, 'Failed to load tool defs from skill');
      }
    }
    return defs;
  }

  /** 获取 Agent 绑定的 Skill 工具实现 */
  async getToolsForAgent(agentId: string): Promise<SkillToolImpl[]> {
    const db = getDb();
    const bindings = await db.select({ skill_name: agent_skills.skill_name })
      .from(agent_skills)
      .where(eq(agent_skills.agent_id, agentId))
      .all();

    if (bindings.length === 0) return [];

    const impls: SkillToolImpl[] = [];
    for (const b of bindings) {
      const skill = this.vsm().get(b.skill_name);
      if (!skill) continue;

      try {
        const tools = await this.loadToolImplsFromSkill(skill);
        impls.push(...tools);
      } catch (err) {
        logger.warn({ skillName: b.skill_name, err }, 'Failed to load tool impls from skill');
      }
    }
    return impls;
  }

  /** 获取 Agent 的编译后 Skill 提示词 */
  async getPromptForAgent(agentId: string): Promise<string | null> {
    const db = getDb();
    const bindings = await db.select({ skill_name: agent_skills.skill_name })
      .from(agent_skills)
      .where(eq(agent_skills.agent_id, agentId))
      .all();

    if (bindings.length === 0) return null;

    const prompts: string[] = [];
    for (const b of bindings) {
      const skill = this.vsm().get(b.skill_name);
      if (skill?.instructions) {
        prompts.push(`### ${skill.description || b.skill_name}\n${skill.instructions}`);
      }
    }
    return prompts.length > 0 ? prompts.join('\n\n') : null;
  }

  // ── 私有辅助 ──

  /** 从 Skill 目录动态加载工具定义 */
  private async loadToolDefsFromSkill(skill: Skill): Promise<SkillToolDef[]> {
    try {
      const toolsPath = `${skill.path}/tools.ts`;
      // 动态导入 tools.ts 模块
      const mod = await import(`${toolsPath}?update=${Date.now()}`);
      if (!mod.tools && !mod.default) return [];
      const toolExports = mod.tools || mod.default || [];
      const tools = Array.isArray(toolExports) ? toolExports : [toolExports];
      return tools.map((t: any) => ({
        name: t.definition?.name || t.name || 'unknown',
        description: t.definition?.description || t.description || '',
        parameters: t.definition?.parameters || t.definition?.inputSchema || {},
      }));
    } catch {
      return [];
    }
  }

  /** 从 Skill 目录动态加载工具实现 */
  private async loadToolImplsFromSkill(skill: Skill): Promise<SkillToolImpl[]> {
    try {
      const toolsPath = `${skill.path}/tools.ts`;
      const mod = await import(`${toolsPath}?update=${Date.now()}`);
      if (!mod.tools && !mod.default) return [];
      const toolExports = mod.tools || mod.default || [];
      const tools = Array.isArray(toolExports) ? toolExports : [toolExports];
      return tools.map((t: any) => ({
        definition: {
          name: t.definition?.name || t.name || 'unknown',
        },
        handler: t.execute || t.handler || (async () => ''),
      }));
    } catch {
      return [];
    }
  }
}

/** Skill 管理器单例 */
export const skillManager = new SkillManagerService();
