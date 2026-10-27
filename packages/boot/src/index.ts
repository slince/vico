// @vico/boot - Vico Agent Framework 启动层（配置定义 + 领域 provider + bootstrap 入口）

export { createVicoContainer, vicoProviders } from './bootstrap.js';

export { loggerProvider } from './providers/logger-provider.js';
export { skillsProvider } from './providers/skills-provider.js';
export { memoryProvider } from './providers/memory-provider.js';
export { agentProvider } from './providers/agent-provider.js';
export { environmentProvider } from './providers/environment-provider.js';

export { buildTools, type BuildToolsOptions } from './lib/build-tools.js';
export { buildSkills, type SkillOptions, type SkillSettings } from './lib/build-skills.js';

export {
  agentSchema,
  loggerSchema,
  skillsSchema,
  memoryCompactionSchema,
  memorySchema,
  modelSchema,
  ragSchema,
  toolSchema,
  workspaceSchema,
  checkpointSchema,
  storageSchema,
} from './config/schemas/index.js';

export type { VicoConfigKeys } from './config/keys.js';
export type { VicoConfig } from './config/types.js';
export type { VicoTokens, VicoContainer, VicoServiceProvider } from './tokens.js';
