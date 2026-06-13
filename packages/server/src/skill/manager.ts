import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { scanSkillDirs, loadSkill } from './loader.js';
import { LoadedSkill, SkillTool, SkillToolDef } from './types.js';
import { getDb, schema } from '../db/db.js';

const { agent_skills, installed_skills } = schema;

interface SkillRegistryEntry {
  skillName: string;
  skillDir: string;
  loaded: LoadedSkill;
}

class SkillManager {
  private registry: Map<string, SkillRegistryEntry> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const dirs = await scanSkillDirs(config.skills.scan_paths);
    for (const dir of dirs) {
      try {
        const loaded = await loadSkill(dir);
        this.registry.set(loaded.manifest.name, { skillName: loaded.manifest.name, skillDir: dir, loaded });
        console.log(`[SkillManager] Discovered: ${loaded.manifest.name} (${loaded.manifest.version})`);
      } catch (err) {
        console.error(`[SkillManager] Failed to load skill from ${dir}:`, err);
      }
    }
  }

  getAllManifests() {
    return Array.from(this.registry.values()).map((e) => e.loaded.manifest);
  }

  getManifest(name: string) {
    return this.registry.get(name)?.loaded.manifest ?? null;
  }

  getSkillDir(name: string): string | null {
    return this.registry.get(name)?.skillDir ?? null;
  }

  async getToolsForAgent(agentId: string): Promise<SkillTool[]> {
    const db = getDb();
    const bindings = await db.select({ skill_name: agent_skills.skill_name, config: agent_skills.config })
      .from(agent_skills).where(eq(agent_skills.agent_id, agentId)).all();

    const tools: SkillTool[] = [];
    for (const binding of bindings) {
      const entry = this.registry.get(binding.skill_name);
      if (entry) {
        for (const tool of entry.loaded.tools) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  async getToolDefsForAgent(agentId: string): Promise<SkillToolDef[]> {
    const tools = await this.getToolsForAgent(agentId);
    return tools.map((t) => t.definition);
  }

  async getPromptForAgent(agentId: string): Promise<string> {
    const db = getDb();
    const bindings = await db.select({ skill_name: agent_skills.skill_name })
      .from(agent_skills).where(eq(agent_skills.agent_id, agentId)).all();

    const prompts: string[] = [];
    for (const binding of bindings) {
      const entry = this.registry.get(binding.skill_name);
      if (entry && entry.loaded.prompt) {
        prompts.push(entry.loaded.prompt);
      }
    }
    return prompts.join('\n\n');
  }

  async registerToAgent(agentId: string, skillName: string, config_override: Record<string, any> = {}) {
    const manifest = this.getManifest(skillName);
    if (!manifest) throw new Error(`Skill not found: ${skillName}`);

    const db = getDb();
    await db.insert(agent_skills).values({
      agent_id: agentId, skill_name: skillName, config: JSON.stringify(config_override),
    }).onConflictDoUpdate({
      target: [agent_skills.agent_id, agent_skills.skill_name],
      set: { config: JSON.stringify(config_override) },
    }).run();
  }

  async unregisterFromAgent(agentId: string, skillName: string) {
    const db = getDb();
    await db.delete(agent_skills).where(
      and(eq(agent_skills.agent_id, agentId), eq(agent_skills.skill_name, skillName))
    ).run();
  }

  async installSkill(tenantId: string, skillName: string, config_override: Record<string, any> = {}) {
    const manifest = this.getManifest(skillName);
    if (!manifest) throw new Error(`Skill not found: ${skillName}`);

    const db = getDb();
    const existing = await db.select({ id: installed_skills.id }).from(installed_skills)
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, skillName)))
      .get();
    if (existing) throw new Error(`Skill already installed: ${skillName}`);

    const id = uuid();
    await db.insert(installed_skills).values({
      id, tenant_id: tenantId, skill_name: skillName, display_name: manifest.displayName,
      version: manifest.version, config: JSON.stringify(config_override), enabled: 1, installed_at: Date.now(),
    }).run();
    return { id, ...manifest };
  }

  async uninstallSkill(tenantId: string, skillName: string) {
    const db = getDb();
    await db.delete(installed_skills).where(
      and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, skillName))
    ).run();
    await db.delete(agent_skills).where(eq(agent_skills.skill_name, skillName)).run();
  }

  async toggleSkill(tenantId: string, skillName: string, enabled: boolean) {
    const db = getDb();
    await db.update(installed_skills).set({ enabled: enabled ? 1 : 0 })
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, skillName)))
      .run();
  }

  async updateSkillConfig(tenantId: string, skillName: string, config: Record<string, any>) {
    const db = getDb();
    await db.update(installed_skills).set({ config: JSON.stringify(config) })
      .where(and(eq(installed_skills.tenant_id, tenantId), eq(installed_skills.skill_name, skillName)))
      .run();
  }

  async getInstalledSkills(tenantId: string) {
    const db = getDb();
    return db.select().from(installed_skills).where(eq(installed_skills.tenant_id, tenantId)).all();
  }
}

export const skillManager = new SkillManager();
