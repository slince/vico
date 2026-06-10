import { config } from '../config.js';
import { scanSkillDirs, loadSkill } from './loader.js';
import { LoadedSkill, SkillTool, SkillToolDef } from './types.js';
import { getDb } from '../data/db.js';
import { v4 as uuid } from 'uuid';

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

  getToolsForAgent(agentId: string): SkillTool[] {
    const db = getDb();
    const bindings = db.prepare('SELECT skill_name, config FROM agent_skills WHERE agent_id = ?').all(agentId) as { skill_name: string; config: string }[];

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

  getToolDefsForAgent(agentId: string): SkillToolDef[] {
    return this.getToolsForAgent(agentId).map((t) => t.definition);
  }

  getPromptForAgent(agentId: string): string {
    const db = getDb();
    const bindings = db.prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?').all(agentId) as { skill_name: string }[];

    const prompts: string[] = [];
    for (const binding of bindings) {
      const entry = this.registry.get(binding.skill_name);
      if (entry && entry.loaded.prompt) {
        prompts.push(entry.loaded.prompt);
      }
    }
    return prompts.join('\n\n');
  }

  registerToAgent(agentId: string, skillName: string, config_override: Record<string, any> = {}) {
    const db = getDb();
    const manifest = this.getManifest(skillName);
    if (!manifest) throw new Error(`Skill not found: ${skillName}`);

    db.prepare('INSERT OR REPLACE INTO agent_skills (agent_id, skill_name, config) VALUES (?, ?, ?)').run(
      agentId, skillName, JSON.stringify(config_override)
    );
  }

  unregisterFromAgent(agentId: string, skillName: string) {
    const db = getDb();
    db.prepare('DELETE FROM agent_skills WHERE agent_id = ? AND skill_name = ?').run(agentId, skillName);
  }

  installSkill(tenantId: string, skillName: string, config_override: Record<string, any> = {}) {
    const db = getDb();
    const manifest = this.getManifest(skillName);
    if (!manifest) throw new Error(`Skill not found: ${skillName}`);

    const existing = db.prepare('SELECT id FROM installed_skills WHERE tenant_id = ? AND skill_name = ?').get(tenantId, skillName);
    if (existing) throw new Error(`Skill already installed: ${skillName}`);

    const id = uuid();
    db.prepare('INSERT INTO installed_skills (id, tenant_id, skill_name, display_name, version, config, enabled, installed_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(
      id, tenantId, skillName, manifest.displayName, manifest.version, JSON.stringify(config_override), Date.now()
    );
    return { id, ...manifest };
  }

  uninstallSkill(tenantId: string, skillName: string) {
    const db = getDb();
    db.prepare('DELETE FROM installed_skills WHERE tenant_id = ? AND skill_name = ?').run(tenantId, skillName);
    db.prepare('DELETE FROM agent_skills WHERE skill_name = ?').run(skillName);
  }

  toggleSkill(tenantId: string, skillName: string, enabled: boolean) {
    const db = getDb();
    db.prepare('UPDATE installed_skills SET enabled = ? WHERE tenant_id = ? AND skill_name = ?').run(enabled ? 1 : 0, tenantId, skillName);
  }

  updateSkillConfig(tenantId: string, skillName: string, config: Record<string, any>) {
    const db = getDb();
    db.prepare('UPDATE installed_skills SET config = ? WHERE tenant_id = ? AND skill_name = ?').run(JSON.stringify(config), tenantId, skillName);
  }

  getInstalledSkills(tenantId: string) {
    const db = getDb();
    return db.prepare('SELECT * FROM installed_skills WHERE tenant_id = ?').all(tenantId);
  }
}

export const skillManager = new SkillManager();
