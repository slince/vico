// src/skill/skill-tools.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolSpec } from '../tool/types.js';
import type { SkillManager } from './skill-manager.js';

export function createSkillTools(manager: SkillManager): ToolSpec[] {
  return [
    {
      name: 'skill',
      description:
        'Load the full instructions for a skill by name. Use this when you need detailed guidance from a specific skill.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The skill name to load' },
        },
        required: ['name'],
      },
      policy: 'auto',
      kind: 'readonly',
    },
    {
      name: 'skill_search',
      description: 'Search across all available skills by keyword. Returns matching skills with relevance scores.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
      policy: 'auto',
      kind: 'readonly',
    },
    {
      name: 'skill_read',
      description: 'Read a file from a skill\'s references, scripts, or assets directory.',
      inputSchema: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: 'The skill name' },
          filePath: { type: 'string', description: 'Relative path within the skill directory' },
        },
        required: ['skillName', 'filePath'],
      },
      policy: 'auto',
      kind: 'readonly',
    },
  ];
}

/** 创建 skill 工具的 handler */
export function createSkillToolHandlers(manager: SkillManager) {
  return {
    skill: {
      execute: async (call: { name: string }) => {
        const skill = manager.get(call.name);
        if (!skill) return `Skill "${call.name}" not found. Available: ${manager.listAll().map((s) => s.name).join(', ')}`;
        return JSON.stringify({
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          references: skill.references,
          scripts: skill.scripts,
          assets: skill.assets,
        });
      },
    },
    skill_search: {
      execute: async (call: { query: string; limit?: number }) => {
        const results = manager.search(call.query, call.limit ?? 10);
        return JSON.stringify(results);
      },
    },
    skill_read: {
      execute: async (call: { skillName: string; filePath: string }) => {
        const skill = manager.get(call.skillName);
        if (!skill) return `Skill "${call.skillName}" not found`;
        const fullPath = resolve(skill.path, call.filePath);
        if (!existsSync(fullPath)) return `File not found: ${call.filePath}`;
        try {
          return readFileSync(fullPath, 'utf-8');
        } catch {
          return `Cannot read file: ${call.filePath} (may be binary)`;
        }
      },
    },
  };
}
