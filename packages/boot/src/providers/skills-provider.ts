// @vico/boot - Skill 领域 provider（扫描并注册 skills）

import { buildSkills } from '../lib/build-skills.js';
import { skillsSchema } from '../config/schemas/index.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * Skill provider：声明 `skills` 配置段 schema，并注册 `skills` 服务
 * （通过 `buildSkills` 从 `skills.scan_paths` 扫描加载；`compatible` 开启时
 * 额外扫描全局第三方 Agent 产品的 Skills 目录）。
 *
 * 工厂为异步（文件系统扫描），需通过 `resolve('skills')` 解析。
 */
export const skillsProvider: VicoServiceProvider = {
  register(c) {
    c.registerConfig('skills', skillsSchema);

    c.register('skills', ({ getConfig }) => {
      const { scan_paths, compatible } = getConfig('skills');
      return buildSkills({ skillDirs: scan_paths, compatible });
    });
  },
};
