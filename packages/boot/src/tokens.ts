// @vico/boot - 依赖 token 映射与容器/provider 类型别名

import type { Container, ServiceProvider } from '@vico/di';
import type { AgentRuntime } from '@vico/agent';
import type { CheckpointPurge, CheckpointStore } from '@vico/checkpoint';
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
  /** checkpoint 版本链 TTL 清理器（后台定时清理） */
  checkpointPurge: CheckpointPurge;
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
  /** 持久化后端数据库连接（libsql/mysql 的 drizzle db），由使用方注入；memory 后端无需。token 名可由 storage.db_service 覆盖 */
  db: unknown;
  /** 向量存储客户端（libsql 的 Client 或 chroma 的 ChromaClient），由使用方注入；memory 后端无需。token 名可由 storage.client_service 覆盖 */
  client: unknown;
}

/** Vico 容器类型：配置全部走 registerConfig/load */
export type VicoContainer = Container<VicoTokens, VicoConfigKeys>;

/** Vico 领域 provider 类型（register 绑定依赖，boot 执行初始化副作用） */
export type VicoServiceProvider = ServiceProvider<VicoTokens, VicoConfigKeys>;
