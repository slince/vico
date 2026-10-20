/**
 * server 业务层依赖 token 映射 — 在 framework `VicoTokens` 之上窄化连接类型并追加业务服务。
 *
 * `VicoTokens` 把 `db`/`client` 声明为 `unknown`（framework 不限定持久化后端）；server 固定
 * libsql 后端，在此窄化为 `AppDb`/`Client`，并登记全部业务 service、认证实例、天气工具与
 * LLM 厂商目录，供各处 `get('xxx')` / `resolve('xxx')` 类型安全取用。
 *
 * 本文件只做类型映射，全部依赖均用 `import type`（`typeof` 查询），运行时零导入，
 * 不与 `db → container` 链路形成循环。
 */
import type { Container, ServiceProvider } from '@vico/di';
import type { Client } from '@libsql/client';
import type { VicoTokens } from '@vico/boot';
import type { ServerConfigKeys } from './config/schemas.js';
import type { AppDb } from './db/db.js';
import type { getAuth } from './auth/get-auth.js';
import type { AgentManager } from './services/agent/agent-manager.js';
import type { AgentFactory } from './lib/agent-factory.js';
import type { ModelManager } from './services/model/model-manager.js';
import type { ThreadManager } from './services/thread/thread-manager.js';
import type { KnowledgeManager } from './services/knowledge/knowledge-manager.js';
import type { StorageManager } from './services/knowledge/storage-manager.js';
import type { DocumentManager } from './services/knowledge/document-manager.js';
import type { RAGManager } from './lib/rag-manager.js';
import type { TerminalManager } from './lib/terminal-manager.js';
import type { weatherTool } from './agent/tools/weather-tool.js';
import type { meta, providers } from './llm/providers/index.js';

/**
 * server token 映射：framework 核心抽象（继承自 `VicoTokens`）+ 应用层连接与业务服务。
 */
export interface ServerTokens extends VicoTokens {
  /** 持久化数据库连接（libsql drizzle，窄化自 VicoTokens 的 unknown） */
  db: AppDb;
  /** 向量表客户端（libsql Client，窄化自 VicoTokens 的 unknown） */
  client: Client;
  /** better-auth 实例（懒加载，首次 get 时初始化） */
  auth: ReturnType<typeof getAuth>;
  agentManager: AgentManager;
  agentFactory: AgentFactory;
  modelManager: ModelManager;
  threadManager: ThreadManager;
  knowledgeManager: KnowledgeManager;
  storageManager: StorageManager;
  documentManager: DocumentManager;
  ragManager: RAGManager;
  terminalManager: TerminalManager;
  weatherTool: typeof weatherTool;
  llmProviders: { meta: typeof meta; providers: typeof providers };
}

/** server 容器类型（framework + 应用层配置段、ServerTokens 视角） */
export type ServerContainer = Container<ServerTokens, ServerConfigKeys>;

/** server provider 类型 */
export type ServerServiceProvider = ServiceProvider<ServerTokens, ServerConfigKeys>;
