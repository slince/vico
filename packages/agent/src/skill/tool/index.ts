// src/skill/tool/index.ts
export { createSkillLoadTool } from './skill-load.js';
export { createSkillSearchTool } from './skill-search.js';
export { createSkillReadTool } from './skill-read.js';

import { createSkillLoadTool } from './skill-load.js';
import { createSkillSearchTool } from './skill-search.js';
import { createSkillReadTool } from './skill-read.js';
import type { SkillManager } from '../skill-manager.js';
import type { Tool } from '../../tool/types.js';

/**
 * 创建 Skill 模块的全部工具（load / search / read）。
 * @param manager - SkillManager 实例
 * @returns 包含三个 Skill 工具的数组
 */
export function createAllSkillTools(manager: SkillManager): Tool[] {
  return [
    createSkillLoadTool(manager),
    createSkillSearchTool(manager),
    createSkillReadTool(manager),
  ];
}
