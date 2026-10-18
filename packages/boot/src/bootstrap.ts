// @vico/boot - Vico Agent Framework 启动入口（容器装配 + provider 两阶段启动）

import { fileURLToPath } from 'node:url';
import { createContainer } from '@vico/di';
import type { Container } from '@vico/di';
import type { VicoConfigKeys } from './config/keys.js';
import type { VicoServiceProvider, VicoTokens } from './tokens.js';
import { skillsProvider } from './providers/skills-provider.js';
import { memoryProvider } from './providers/memory-provider.js';
import { agentProvider } from './providers/agent-provider.js';
import { configProvider } from './providers/config-provider.js';

/** 包内默认配置文件的绝对路径（默认值唯一来源） */
const DEFAULT_CONFIG_FILE = fileURLToPath(
  new URL('./config/default.config.yaml', import.meta.url),
);

/** createVicoContainer 启动选项 */
export interface CreateVicoContainerOptions<TConfigKeys extends VicoConfigKeys = VicoConfigKeys> {
  /** 用户自定义配置文件路径（覆盖内置默认，后加载覆盖先加载） */
  configPath?: string;
  /** 在 framework providers 注册后、加载配置/冻结前调用，用于注入连接或注册应用层 provider */
  setup?: (container: Container<VicoTokens, TConfigKeys>) => void | Promise<void>;
}

/**
 * 创建 Vico 容器：注册 framework 领域 provider → 调用使用方 setup 扩展 → 加载配置 → 冻结。
 *
 * 各 provider 在 register 阶段自行声明其领域配置段 schema（registerConfig）并绑定服务；
 * 未被任何领域服务消费的 framework 配置段（model/tool/workspace/checkpoint）由
 * `configProvider` 统一声明。先注册 provider（声明 schema），再 load 配置，load 时即验证。
 *
 * 加载顺序沿用 `@vico/di` 的「后加载覆盖先加载」语义：内置默认配置先加载，
 * 用户 `configPath`（可选）后加载，同名段整段覆盖、段内字段由 schema `.default()` 兜底。
 *
 * 本函数只做 provider 注册 + 配置加载，不触发 boot；`load` 成功后容器自动冻结，
 * 不再允许注入新的 service。调用方随后自行 `boot()`。
 *
 * @typeParam TConfigKeys 扩展后的配置段映射（必须继承 `VicoConfigKeys`），
 *   使用方传入 `interface ServerConfigKeys extends VicoConfigKeys { ... }` 即可追加应用层段
 * @param options 可选启动选项；`configPath` 为用户配置路径，`setup` 为冻结前的扩展回调
 * @returns 已完成 provider 注册与配置加载（已冻结，未 boot）的容器
 */
export async function createVicoContainer<
  TConfigKeys extends VicoConfigKeys = VicoConfigKeys,
>(
  options?: CreateVicoContainerOptions<TConfigKeys>,
): Promise<Container<VicoTokens, TConfigKeys>> {
  const container = createContainer<VicoTokens, TConfigKeys>();

  // 先注册 framework 领域 provider（register 阶段声明配置段 schema 并绑定服务）
  // provider 以 VicoConfigKeys 视角注册 framework 段（其 schema 类型在两种视角下完全一致）
  const framework = container as unknown as Container<VicoTokens, VicoConfigKeys>;
  for (const provider of vicoProviders) {
    await framework.registerProvider(provider);
  }

  // 使用方扩展：注入连接 / 注册应用层 provider（须在 load/freeze 前完成）
  if (options?.setup) {
    await options.setup(container);
  }

  // 再读配置：内置默认 → 用户覆盖（后加载覆盖先加载）；此时 schema 已注册，load 即验证
  // load 成功后容器自动冻结，无需显式 freeze
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
 * → events → agentRuntime；`configProvider` 兜底声明纯配置段。
 */
export const vicoProviders: VicoServiceProvider[] = [
  skillsProvider,
  memoryProvider,
  agentProvider,
  configProvider,
];
