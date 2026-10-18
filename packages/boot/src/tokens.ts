// @vico/boot - 依赖 token 映射与容器/provider 类型别名

import type { Container, ServiceProvider } from '@vico/di';
import type { AgentRuntime } from '@vico/agent';
import type { CheckpointStore } from '@vico/checkpoint';
import type { EventRecorder } from '@vico/events';
import type { MemoryStore } from '@vico/memory';
import type { Embedder, VectorStore } from '@vico/rag';
import type { Skill } from '@vico/skill';
import type { TurnEvent } from '@vico/stream';
import type { ThreadStore } from '@vico/thread';
import type { VicoConfigKeys } from './config/keys.js';

/**
 * Vico Agent Framework 依赖 token 映射：token 名 → 实例类型。
 *
 * 只声明 framework 核心抽象（对应 packages/ 下各子包的能力）；数据库连接、
 * HTTP 服务、认证等应用层依赖由使用方自行扩展。
 */
export interface VicoTokens {
  /** 事件广播器（turn 级事件） */
  events: EventRecorder<TurnEvent>;
  /** 线程存储 */
  thread: ThreadStore;
  /** checkpoint 存储 */
  checkpointStore: CheckpointStore;
  /** 嵌入器（配置为 "none" 时禁用，值为 undefined） */
  embedder: Embedder | undefined;
  /** 向量存储 */
  vectorStore: VectorStore;
  /** 三层记忆存储 */
  memory: MemoryStore;
  /** 扫描加载后的 Skill 列表 */
  skills: Skill[];
  /** Agent 运行时（LRU 缓存） */
  agentRuntime: AgentRuntime;
}

/** Vico 容器类型：构造时不注入 config，配置全部走 registerConfig/load */
export type VicoContainer = Container<undefined, VicoTokens, VicoConfigKeys>;

/** Vico 领域 provider 类型（register 绑定依赖，boot 执行初始化副作用） */
export type VicoServiceProvider = ServiceProvider<undefined, VicoTokens, VicoConfigKeys>;
