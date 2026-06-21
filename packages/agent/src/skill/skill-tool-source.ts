// src/skill/skill-tool-source.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool, ToolCall, ToolExecutionContext, ToolSource } from '../tool/types.js';
import type { SkillManager } from './skill-manager.js';

function createSkillTools(manager: SkillManager): Tool[] {
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
      tags: ['skill'],
      execute: async (call: ToolCall) => {
        const { name } = call.args as { name: string };
        const skill = manager.get(name);
        if (!skill) return `Skill "${name}" not found. Available: ${manager.listAll().map((s) => s.name).join(', ')}`;
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
      tags: ['skill'],
      execute: async (call: ToolCall) => {
        const { query, limit } = call.args as { query: string; limit?: number };
        const results = manager.search(query, limit ?? 10);
        return JSON.stringify(results);
      },
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
      tags: ['skill'],
      execute: async (call: ToolCall) => {
        const { skillName, filePath } = call.args as { skillName: string; filePath: string };
        const skill = manager.get(skillName);
        if (!skill) return `Skill "${skillName}" not found`;
        const fullPath = resolve(skill.path, filePath);
        if (!existsSync(fullPath)) return `File not found: ${filePath}`;
        try {
          return readFileSync(fullPath, 'utf-8');
        } catch {
          return `Cannot read file: ${filePath} (may be binary)`;
        }
      },
    },
  ];
}

/** 创建 Skill 模块的 ToolSource */
export function createSkillToolSource(manager: SkillManager): ToolSource {
  return {
    name: 'skill',
    list: async (): Promise<Tool[]> => createSkillTools(manager),
  };
}
