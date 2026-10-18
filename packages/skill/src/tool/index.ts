// @vico/skill - Skill 工具入口（search / execute）

import { SkillRegistry } from '../skill-registry.js';
import { createSkillSearchTool } from './skill-search.js';
import { createSkillExecuteTool } from './skill-execute.js';
import type { Skill } from '../types.js';
import type { Tool } from '@vico/tool';

export { createSkillSearchTool } from './skill-search.js';
export { createSkillExecuteTool } from './skill-execute.js';

/**
 * 创建 Skill 模块的全部工具（search / execute）。
 * @param skills - skills 实例列表
 * @returns 包含两个 Skill 工具的数组
 */
export function createSkillTools(skills: Skill[]): Tool[] {
  const registry = new SkillRegistry(skills);

  return [
    createSkillSearchTool(registry),
    createSkillExecuteTool(registry),
  ];
}
