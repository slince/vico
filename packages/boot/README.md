# @vico/boot

Vico **Agent Framework** 启动层：把 framework 的「配置定义」与「启动流程」沉淀成约定俗成的写法。

- 依赖 `@vico/di`（工厂 Provider + 配置加载 + ServiceProvider 两阶段启动）
- 配置按领域拆分为多段 zod schema，内置默认值唯一来源是 `src/config/default.config.yaml`
- 领域逻辑以 `ServiceProvider` 形式组织：`register` 只绑定依赖，`boot` 执行初始化副作用
- 默认装配 framework 核心依赖（`storage` 配置段驱动 thread/checkpoint/vector store 后端，
  默认内存实现；embedder/memory 由配置驱动）

> **边界**：只涵盖 framework 自身能力（`packages/` 下各子包）。应用层专属功能
> （HTTP 服务、认证、数据库连接、文件存储/上传等）不在本包内，由使用方自行扩展。

## 目录结构

```
src/
├── config/
│   ├── schemas/          # 9 个配置段 zod schema（按领域拆分，字段级 .default() 兜底）
│   │   └── index.ts      # 聚合导出
│   ├── default.config.yaml  # 内置默认配置（默认值唯一来源）
│   ├── keys.ts           # VicoConfigKeys（段名 → schema 类型）
│   └── types.ts          # VicoConfig（各段 z.infer 合并）
├── tokens.ts             # VicoTokens（token 名 → 实例类型）+ 容器/provider 类型别名
├── lib/
│   └── in-memory-vector-store.ts  # 内存 VectorStore（framework 默认装配）
├── providers/            # 领域 provider（register 绑定 + boot 副作用）
│   ├── skills-provider.ts
│   ├── memory-provider.ts
│   ├── agent-provider.ts
│   ├── filesystem-provider.ts  # 文件系统实现（默认 localFilesystem）
│   ├── workspace-provider.ts   # workspace 配置段 + 默认工作空间 token
│   └── config-provider.ts      # 无对应服务的配置段（model/tool）
├── bootstrap.ts          # createVicoContainer / bootstrapVico
└── index.ts              # 导出
```

## 用法

```ts
import { bootstrapVico, createVicoContainer } from '@vico/boot';

// 一键启动（内置默认配置，可用 configPath 覆盖）
const container = await bootstrapVico({ configPath: './vico.config.yaml' });

container.get('agentRuntime');        // AgentRuntime（LRU 缓存）
container.get('memory');              // MemoryStore（conversation + episodic）
container.get('thread');              // 默认 memory 后端：InMemoryThreadStore
container.get('checkpointStore');     // 默认 memory 后端：MemoryCheckpointStore
await container.resolve('skills');   // Skill[]（异步扫描）
```

持久化后端通过 `storage` 配置段选择，连接由使用方注入：

```ts
// vico.config.yaml
// storage:
//   thread: libsql
//   checkpoint: libsql
//   vector: chroma
//   db_service: db          # 连接 token 名（service id），默认 db
//   client_service: client  # 向量客户端 token 名，默认 client

const c = createVicoContainer({ configPath: './vico.config.yaml' });

c.register('db', () => drizzle(...));        // thread/checkpoint 后端所需的 drizzle db
c.register('client', () => chromaClient);   // vector 后端所需的客户端（libsql Client / ChromaClient）

await c.bootstrap(vicoProviders);
```

## 约定

### 配置

- 每个领域一段 schema（`agent`/`skills`/`memory`/`model`/`rag`/`tool`/`workspace`/
  `checkpoint`/`storage`），通过 `registerConfig` 注册。
- 默认值**只写在 `default.config.yaml`**，schema 的 `.default()` 仅兜底段内字段缺失，
  避免两处双写。
- 加载顺序：内置默认 → 用户 `configPath`（后加载同名段整段覆盖先加载）。
- 使用方扩展应用层配置：继续在容器上 `registerConfig('server', serverSchema)` 并 `load`，
  与 framework 段共存。

### Provider

每个领域一个 `ServiceProvider` 对象，遵循两阶段：

1. `register`：只做绑定（`c.register`），不实例化、不做副作用；
2. `boot`（可选）：所有 provider 注册完成后按声明顺序调用，此时可安全 get
   依赖、执行异步初始化（预热、起定时器等）。

依赖拓扑（provider 注册顺序的自然依据）：

```
skills → thread/checkpointStore/vectorStore → embedder → memory
       → events → agentRuntime → filesystem → workspace
```

### 默认装配

- `thread` / `checkpointStore` / `vectorStore`：后端由 `storage` 配置段驱动
  （thread/checkpoint 支持 `memory`/`libsql`/`mysql`，vector 支持 `memory`/`libsql`/`chroma`），
  默认均为 `memory`。持久化后端所需的连接由使用方注入，其 token 名（service id）由
  `storage.db_service` / `storage.client_service` 指定（默认 `db` / `client`），
  boot 只按配置选择实现、不自行建立连接。
- `embedder`：由 `rag.embedder` 配置驱动；`"none"` 禁用（返回 undefined），episodic 记忆随之停用。
- `memory`：`conversation`（短时窗口）+ `episodic`（embedder 可用时启用）。
- `skills`：异步工厂，从 `skills.scan_paths` 扫描加载（`compatible` 开启时额外扫描全局第三方 Agent 产品的 Skills 目录），需 `resolve`。

## 迁移 server（后续）

把 `vico/server` 的 framework 相关装配迁移进来，应用层专属装配留在 server：

- `config.ts` 的 framework 段 → `config/schemas/` + `default.config.yaml`（已就绪）
- `vico.ts` 的 `Vico` 类（已 `@deprecated`）→ `agent-provider.ts` 的 `agentRuntime`
- `memory-setup.ts` / `embedder.ts` → `memory-provider.ts`
- skill 扫描加载 → `skills-provider.ts`
- server 保留：`server`/`auth`/`database`/`storage`/`upload` 配置段、`app.ts` + `serve`
