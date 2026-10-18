// @vico/boot - Vico Agent Framework 启动入口（容器装配 + provider 两阶段启动）

import { fileURLToPath } from 'node:url';
import { createContainer } from '@vico/di';
import {
  checkpointSchema,
  memorySchema,
  modelSchema,
  ragSchema,
  skillsSchema,
  toolSchema,
  workspaceSchema,
} from './config/schemas.js';
import type { VicoConfigKeys } from './config/keys.js';
import type { VicoContainer, VicoServiceProvider, VicoTokens } from './tokens.js';
import { skillsProvider } from './providers/skills-provider.js';
import { memoryProvider } from './providers/memory-provider.js';
import { agentProvider } from './providers/agent-provider.js';

/** 包内默认配置文件的绝对路径（默认值唯一来源） */
const DEFAULT_CONFIG_FILE = fileURLToPath(
  new URL('./config/default.config.yaml', import.meta.url),
);

/**
 * 创建 Vico 容器：注册全部配置段 schema，并加载「内置默认 + 用户覆盖」两层配置。
 *
 * 加载顺序沿用 `@vico/di` 的「后加载覆盖先加载」语义：内置默认配置先加载，
 * 用户 `configPath`（可选）后加载，同名段整段覆盖、段内字段由 schema `.default()` 兜底。
 *
 * 只注册 framework 自身配置段（skills/memory/model/rag/tool/workspace/checkpoint）；
 * 应用层专属配置由使用方通过 `registerConfig` 扩展。
 *
 * @param options 可选启动选项；`configPath` 为用户自定义配置文件路径
 * @returns 已注册配置但尚未 bootstrap 的 Vico 容器
 */
export function createVicoContainer(options?: { configPath?: string }): VicoContainer {
  const container = createContainer<undefined, VicoTokens, VicoConfigKeys>();

  // 逐个注册配置段（schema 类型由 VicoConfigKeys 约束，getConfig 得到 z.infer 类型）
  container
    .registerConfig('skills', skillsSchema)
    .registerConfig('memory', memorySchema)
    .registerConfig('model', modelSchema)
    .registerConfig('rag', ragSchema)
    .registerConfig('tool', toolSchema)
    .registerConfig('workspace', workspaceSchema)
    .registerConfig('checkpoint', checkpointSchema);

  // 内置默认 → 用户覆盖（后加载覆盖先加载）
  container.load(DEFAULT_CONFIG_FILE);
  if (options?.configPath) {
    container.load(options.configPath);
  }
  return container;
}

/**
 * Vico Agent Framework 的全部领域 providers，按声明顺序执行 register 再 boot。
 *
 * 依赖拓扑（注册顺序的自然依据）：
 * skills → thread/checkpointStore/vectorStore → embedder → memory
 * → toolExecutor → agentRuntime。
 */
export const vicoProviders: VicoServiceProvider[] = [
  skillsProvider,
  memoryProvider,
  agentProvider,
];

/**
 * 启动 Vico：创建容器并依序执行 providers 的 register/boot 两阶段。
 *
 * @param options 可选启动选项；`configPath` 为用户自定义配置文件路径
 * @returns 完成启动后的容器（各依赖可安全 resolve）
 */
export async function bootstrapVico(options?: { configPath?: string }): Promise<VicoContainer> {
  const container = createVicoContainer(options);
  await container.bootstrap(vicoProviders);
  return container;
}
