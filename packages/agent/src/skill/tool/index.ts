// src/skill/tool/index.ts
import {Skill} from "../types.js";
import {createSkillLoadTool} from './skill-load.js';
import {createSkillSearchTool} from './skill-search.js';
import {createSkillReadTool} from './skill-read.js';
import type {Tool} from '../../tool/types.js';
import {SkillRegistry} from "../skill-registry.js";

export { createSkillLoadTool } from './skill-load.js';
export { createSkillSearchTool } from './skill-search.js';
export { createSkillReadTool } from './skill-read.js';

/**
 * 创建 Skill 模块的全部工具（load / search / read）。
 * @param skills - skills 实例
 * @returns 包含三个 Skill 工具的数组
 */
export function createSkillTools(skills: Skill[]): Tool[] {

  const registry = new SkillRegistry(skills);

  return [
    createSkillLoadTool(registry),
    createSkillSearchTool(registry),
    createSkillReadTool(registry),
  ];
}
