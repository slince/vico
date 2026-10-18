/**
 * server 业务服务 provider — 把业务 Manager 与工具依赖按依赖拓扑装配进容器。
 *
 * 全部依赖在 register 阶段以懒工厂绑定（`resolve` 递归触发构建）；各服务类已彻底
 * 构造注入（含 db/client 连接），不再有模块级单例。db/client 连接由 bootstrap()
 * 显式注入后，在此被各服务按需 resolve。
 */
import { getAuth } from '../auth/get-auth.js';
import { AgentManager } from '../services/agent/agent-manager.js';
import { ModelManager } from '../services/model/model-manager.js';
import { ThreadManager } from '../services/thread/thread-manager.js';
import { KnowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { StorageManager } from '../services/knowledge/storage-manager.js';
import { DocumentManager } from '../services/knowledge/document-manager.js';
import { RAGManager } from '../lib/rag-manager.js';
import { TerminalManager } from '../lib/terminal-manager.js';
import { weatherTool } from '../agent/tools/weather-tool.js';
import { meta, providers } from '../llm/providers/index.js';
import { getThreadWorkspace } from '../lib/workspace.js';
import { expandHome } from '../lib/path.js';
import type { ServerServiceProvider } from '../tokens.js';

export const servicesProvider: ServerServiceProvider = {
  register(c) {
    // 认证实例（懒加载 betterAuth，首次 resolve 时才初始化连接）
    c.register('auth', () => getAuth());

    c.register('modelManager', ({ resolve }) => new ModelManager(resolve('db')));

    c.register('documentManager', ({ resolve }) => new DocumentManager(resolve('db')));

    c.register('storageManager', ({ getConfig }) => new StorageManager(getConfig('file_storage')));

    c.register('ragManager', ({ resolve, getConfig }) =>
      new RAGManager(
        resolve('db'),
        resolve('client'),
        resolve('vectorStore'),
        resolve('embedder'),
        getConfig('rag'),
        resolve('logger'),
      ));

    c.register('agentManager', ({ resolve, getConfig }) =>
      new AgentManager(
        resolve('db'),
        resolve('modelManager'),
        expandHome(getConfig('workspace').base_path),
      ));

    c.register('threadManager', ({ resolve }) =>
      new ThreadManager(resolve('thread'), resolve('agentManager')));

    c.register('knowledgeManager', ({ resolve, getConfig }) =>
      new KnowledgeManager(
        resolve('db'),
        resolve('ragManager'),
        resolve('documentManager'),
        resolve('storageManager'),
        getConfig('upload'),
      ));

    c.register('terminalManager', ({ resolve }) => new TerminalManager(getThreadWorkspace, resolve('logger')));

    c.register('weatherTool', () => weatherTool);

    c.register('llmProviders', () => ({ meta, providers }));
  },
};
