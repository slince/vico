// @vico/boot - Skill 领域 provider（绑定 skillRegistry）

import type { VicoServiceProvider } from '../tokens.js';

/**
 * Skill provider：注册 `skillRegistry`，从 `skills.scan_paths` 扫描并加载 Skill。
 *
 * 迁移时对应 `@vico/skill` 的 `createFSSkillLoader` + `SkillRegistry`。
 */
export const skillsProvider: VicoServiceProvider = {
  register(c) {
    // TODO(迁移): c.register('skillRegistry', ({ getConfig }) => {
    //   const registry = new SkillRegistry(createFSSkillLoader());
    //   for (const dir of getConfig('skills').scan_paths) registry.scan(dir);
    //   return registry;
    // });
  },
};
