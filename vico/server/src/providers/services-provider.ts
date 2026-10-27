/**
 * server 业务服务 provider — 把业务 Manager 与工具依赖按依赖拓扑装配进容器。
 *
 * 全部依赖在 register 阶段以懒工厂绑定（`get` 递归触发构建）；各服务类已彻底
 * 构造注入（含 db/client 连接），不再有模块级单例。db/client 连接由 bootstrap()
 * 显式注入后，在此被各服务按需 get。
 */
import { getAuth } from '../auth/get-auth.js';
import { AgentFactory } from '../lib/agent-factory.js';
import { AgentManager } from '../services/agent/agent-manager.js';
import { ModelManager } from '../services/model/model-manager.js';
import { ThreadManager } from '../services/thread/thread-manager.js';
import { KnowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { StorageManager } from '../services/knowledge/storage-manager.js';
import { DocumentManager } from '../services/knowledge/document-manager.js';
import { RAGManager } from '../lib/rag-manager.js';
import { TerminalSessionManager } from '@vico/terminal';
import { weatherTool } from '../agent/tools/weather-tool.js';
import { meta, providers } from '../llm/providers/index.js';
import type { ServerServiceProvider } from '../tokens.js';

export const servicesProvider: ServerServiceProvider = {
  register(c) {
    // 认证实例（懒加载 betterAuth，首次 get 时才初始化连接）
    c.register('auth', () => getAuth());

    c.register('modelManager', ({ get }) => new ModelManager(get('db')));

    c.register('documentManager', ({ get }) => new DocumentManager(get('db')));

    c.register('storageManager', ({ getConfig }) => new StorageManager(getConfig('file_storage')));

    c.register('ragManager', ({ get, getConfig }) =>
      new RAGManager(
        get('db'),
        get('client'),
        get('vectorStore'),
        get('embedder'),
        getConfig('rag'),
        get('logger'),
      ));

    c.register('agentManager', ({ get }) =>
      new AgentManager(
        get('db'),
        get('modelManager'),
        get('workspace'),
      ));

    c.register('agentFactory', ({ get, getConfig }) =>
      new AgentFactory(
        get('agentManager'),
        // skill 列表是异步工厂，FactoryContext 只暴露同步 get，这里经容器 resolve 装配
        () => c.resolve('skills'),
        getConfig('memory'),
        getConfig('model'),
      ));

    c.register('threadManager', ({ get }) =>
      new ThreadManager(get('thread'), get('agentManager')));

    c.register('knowledgeManager', ({ get, getConfig }) =>
      new KnowledgeManager(
        get('db'),
        get('ragManager'),
        get('documentManager'),
        get('storageManager'),
        getConfig('upload'),
      ));

    c.register('terminalSessionManager', ({ get }) => new TerminalSessionManager(get('logger')));

    c.register('weatherTool', () => weatherTool);

    c.register('llmProviders', () => ({ meta, providers }));
  },
};
