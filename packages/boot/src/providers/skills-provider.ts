// @vico/boot - Skill 领域 provider（扫描并注册 skills）

import { createFSSkillLoader } from '@vico/skill';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * Skill provider：注册 `skills`（从 `skills.scan_paths` 扫描加载的 Skill 列表）。
 *
 * 工厂为异步（文件系统扫描），需通过 `resolveAsync('skills')` 解析。
 */
export const skillsProvider: VicoServiceProvider = {
  register(c) {
    c.register('skills', ({ getConfig }) => {
      const dirs = getConfig('skills').scan_paths;
      return createFSSkillLoader(dirs)();
    });
  },
};
