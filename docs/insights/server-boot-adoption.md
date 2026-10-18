# vico/server 适配 @vico/boot — 应用层与 framework 职责分离

## 背景

`@vico/boot` 启动层落地后（见 `boot-startup-layer.md`），framework 的配置定义与依赖装配（skills/thread/checkpoint/vector/embedder/memory/events/agentRuntime）已由 boot 容器接管。`vico/server` 仍保留「模块级单例 + `Vico` 类」的旧编排：`config.ts` 手写 12 段配置合并，`vico.ts` 持有全局 `Vico` 实例，`memory-setup.ts`/`embedder.ts` 硬编码 libsql 后端。本次改造把 server 收敛为**应用层**，framework 职责全部交给 boot。

## 目标与边界

- `config.ts` 只保留应用层专属段：`server` / `auth` / `database` / `file_storage` / `upload`。
- framework 段（`skills`/`memory`/`model`/`rag`/`tool`/`workspace`/`checkpoint`/`agent`/`storage`）全部走 boot 容器 `getConfig`。
- 删除 `memory-setup.ts` / `embedder.ts`（其职责由 `memory-provider.ts` 承载）。
- `Vico` 类不再被 server 引用，由薄适配层 `vico.ts`（`listSkills` / `createIfAbsent` / `thread`）替代。

## 关键决策

### 1. `file_storage` 命名，避开与 framework `storage` 冲突

boot 的 `storage` 段 = framework 存储后端选择（thread/checkpoint/vector 的 memory|libsql|mysql/chroma）。
server 原 `storage` 段 = 知识库文件持久化（local/s3）。二者同名不同义，故把 server 段改名为
`file_storage`，`storage-manager.ts` 相应改为 `config.file_storage`。

### 2. server.config.yaml 补齐 framework 段

server 从 libsql 全后端迁移，需在 yaml 中显式声明 framework 后端：

```yaml
memory:
  semantic: libsql        # 原 memory-setup 硬编码 LibSqlSemanticMemory
storage:
  thread: libsql
  checkpoint: libsql
  vector: libsql
  db_service: db          # 连接 token 名（默认 db/client，可省略）
  client_service: client
agent:
  max_cached: 100         # 原 Vico({ maxCached: 100 })
```

### 3. 应用层配置仍走模块级 `config`（时序约束）

`auth/index.ts` 在模块加载时调用 `getDb()`，`getDb()` 依赖 `config.database.url`。
因此 `database` 段必须保留模块级 `loadConfig()` 单例，不能只靠容器（容器在 `bootstrap()`
运行后才可用）。framework 段无此约束，故从 `config.ts` 移除。

### 4. 注入连接 + 应用层 provider

`bootstrap.ts` 里：

- `createVicoContainer({ configPath: CONFIG_PATH })` — 复用 server.config.yaml；
- `container.register('db'/'client', ...)` — 注入 libsql 连接，供 boot 的 thread/checkpoint/vector 工厂解析；
- `container.bootstrap([...vicoProviders, serverProvider])` — serverProvider 的 `boot` 阶段
  执行迁移 → seed → ensure*Tables → startCheckpointPurge（对应旧 `index.ts` main + `initVico`）。

### 5. 薄适配层 `vico.ts`（独立函数，替代 Vico 类）

旧代码通过 `vico.listSkills()` / `vico.createIfAbsent()` / `vico.thread` 访问。新 `vico.ts`
不再导出全局 `vico` 对象，改为独立函数，内部委托容器：

- `listSkills()` → `resolveAsync('skills')`（skills 是异步工厂）；
- `createIfAbsent(id, factory)` → `resolve('agentRuntime')` 查缓存，未命中则 `createAgent`，
  并做 `tools/memory/thread/checkpointStore/events` 的全局 fallback（复制旧 `Vico.buildAgent` 语义）；
- `getThreadStore()` → `resolve('thread')`。

消费点（`api/skills.ts`、`api/fs.ts`、`lib/workspace.ts`、`services/thread/thread-manager.ts`、
`agent/get-agent.ts`）改为按需 `import { listSkills / createIfAbsent / getThreadStore }`，
同时删掉原先针对 `thread` 可能为空的 `if (!store)` 防御（容器保证 ThreadStore 一定存在）。

### 6. RAG 配置函数化 + `~` 展开移到消费点

- `DEFAULT_RAG_CONFIG`（模块级常量，依赖 `config.rag`）改为 `getRagConfig()`，从容器
  `getConfig('rag')` 读取 chunk/retrieval，rerank/no_match/query_rewrite 仍为 server 扩展。
- `workspace.base_path` 由 boot 直接读 yaml（`~/vico` 不自动展开），展开职责移到
  `agent-manager.ts` 消费点（`expandHome(getConfig('workspace').base_path)`）。

## 消费点变更清单

| 文件 | 变更 |
|------|------|
| `config.ts` | 只留 5 个应用层段；导出 `CONFIG_PATH`/`expandHome`/`getRagConfig` |
| `container.ts`（新） | 全局 VicoContainer 单例（setContainer/getContainer） |
| `bootstrap.ts`（新） | 注入 db/client + serverProvider + bootstrap 入口 |
| `vico.ts` | 删除 `Vico` 类与 `initVico`，改为薄适配层 |
| `memory/memory-setup.ts` | 删除（职责并入 boot memoryProvider） |
| `memory/embedder.ts` | 删除（职责并入 boot memoryProvider） |
| `memory/rag.ts` | `getVector`/`createConfiguredEmbedder`/`DEFAULT_RAG_CONFIG` → 容器 |
| `api/knowledge.ts` | `getVector()` → `resolve('vectorStore')` |
| `agent/get-agent.ts` | `config.memory/model` → `getConfig('memory'/'model')` |
| `services/agent/agent-manager.ts` | `config.workspace.base_path` → `getConfig('workspace')` + `expandHome` |
| `services/knowledge/storage-manager.ts` | `config.storage` → `config.file_storage` |
| `index.ts` | `runMigrations`/`seed`/`initVico` → `await bootstrap()` |
| `package.json` | −`@vico/core`（聚合 re-export，改直连底层包）；+`@vico/boot`/`@vico/di`/`@vico/agent`/`@vico/checkpoint`/`@vico/compaction`/`@vico/model`/`@vico/skill`/`@vico/thread`/`@vico/tool`/`@vico/types`；−`@vico/rag-libsql` |

## 验证

- `vico/server` `npx tsc --noEmit` 通过
- `@vico/boot` typecheck/test 不受影响（boot 未改动）
- 运行期由用户验证：`pnpm dev` 启动、登录、聊天、知识库、文件浏览
