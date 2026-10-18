// @vico/skill - Skill 工具入口（list / read）

import { SkillRegistry } from '../skill-registry.js';
import { createSkillListTool } from './skill-list.js';
import { createSkillReadTool } from './skill-read.js';
import type { Skill } from '../types.js';
import type { Tool } from '@vico/tool';

export { createSkillListTool } from './skill-list.js';
export { createSkillReadTool } from './skill-read.js';

/**
 * 创建 Skill 模块的全部工具（list / read）。
 * @param skills - skills 实例列表
 * @returns 包含两个 Skill 工具的数组
 */
export function createSkillTools(skills: Skill[]): Tool[] {
  const registry = new SkillRegistry(skills);

  return [
    createSkillListTool(registry),
    createSkillReadTool(registry),
  ];
}
