// src/skill/skill-tool-source.ts
import type { ToolSource } from '../tool/types.js';
import type { SkillManager } from './skill-manager.js';
import { createAllSkillTools } from './tool/index.js';

/** 创建 Skill 模块的 ToolSource */
export function createSkillToolSource(manager: SkillManager): ToolSource {
  return {
    name: 'skill',
    list: async () => createAllSkillTools(manager),
  };
}
