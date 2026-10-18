// @vico/boot - 依赖 token 映射与容器/provider 类型别名

import type { Container, ServiceProvider } from '@vico/di';
import type { VicoConfigKeys } from './config/keys.js';

/**
 * Vico Agent Framework 依赖 token 映射：token 名 → 实例类型。
 *
 * 只声明 framework 核心抽象（对应 packages/ 下各子包的能力）；数据库连接、
 * HTTP 服务、认证等应用层依赖由使用方自行扩展。迁移时把各 `unknown` 替换为
 * 真实类型，即可获得类型安全的 register/resolve。
 */
export interface VicoTokens {
  /** 装配后的 Agent 运行时（对应已废弃 Vico 类的职责：skills/tools/memory/thread/checkpoint 一键装配） */
  agentRuntime: unknown;
  /** 三层记忆存储 */
  memory: unknown;
  /** 线程存储 */
  thread: unknown;
  /** checkpoint 存储 */
  checkpointStore: unknown;
  /** 嵌入器 */
  embedder: unknown;
  /** 向量存储 */
  vectorStore: unknown;
  /** Skill 注册表（文件系统扫描加载） */
  skillRegistry: unknown;
  /** 工具执行器 */
  toolExecutor: unknown;
}

/** Vico 容器类型：构造时不注入 config，配置全部走 registerConfig/load */
export type VicoContainer = Container<undefined, VicoTokens, VicoConfigKeys>;

/** Vico 领域 provider 类型（register 绑定依赖，boot 执行初始化副作用） */
export type VicoServiceProvider = ServiceProvider<undefined, VicoTokens, VicoConfigKeys>;
