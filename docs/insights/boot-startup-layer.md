# @vico/boot 启动层 —— framework 配置定义 + 启动流程的约定

## 背景

`vico/server` 的启动是「模块级单例 + 手工编排」：`config.ts` 手写 `AppConfig` 与默认值合并，`vico.ts` 持有全局 `vico`（`@vico/core` 的 `Vico` 类）与 `initVico()`，`index.ts` 的 `main()` 手工串 `runMigrations → seed → initVico → serve`。这套编排隐式、难测试、无法注入。

前序工作落地了 `@vico/di`（工厂 Provider + `registerConfig`/`load` 配置加载 + `ServiceProvider`/`bootstrap` 两阶段启动）。本任务把 framework 的「配置定义与启动流程」沉淀成约定：新建 `@vico/boot` 启动层，并标记 `Vico` 类废弃。

## 目标与边界

- `packages/agent/src/vico.ts` 的 `Vico` 类加 `@deprecated` 标记，指向 `@vico/boot` 替代方案（仅加注释，不改行为）。
- 新建 `packages/boot`（`@vico/boot`）：承载 framework 的配置段 schema、默认配置、领域 provider、`bootstrap` 入口，装配 framework 核心依赖。
- **只涵盖 framework 自身能力**（`packages/` 下各子包）。应用层专属功能——HTTP 服务（`server`）、认证（`auth`）、数据库连接（`database`）、文件存储/上传（`storage`/`upload`）——不属于 framework 范围，由使用方（`vico/server`）自行扩展。

## 目录结构

```
packages/boot/src/
├── config/
│   ├── schemas/           # 9 个配置段 zod schema（按领域拆分，index.ts 聚合导出）
│   ├── default.config.yaml  # 内置默认配置（默认值唯一来源）
│   ├── keys.ts            # VicoConfigKeys（段名 → schema 类型）
│   └── types.ts           # VicoConfig（各段 z.infer 合并）
├── tokens.ts              # VicoTokens（token 名 → 实例类型）+ VicoContainer/VicoServiceProvider
├── lib/
│   └── in-memory-vector-store.ts  # 内存 VectorStore（framework 默认装配）
├── providers/             # 领域 provider（register 绑定服务 + 声明本领域配置段）
│   ├── skills-provider.ts
│   ├── memory-provider.ts
│   ├── agent-provider.ts
│   └── config-provider.ts  # 无对应服务的配置段（model/tool/workspace/checkpoint）
├── bootstrap.ts           # createVicoContainer / bootstrapVico / vicoProviders
└── index.ts               # 导出
```

## 关键设计

### 配置约定（9 个 framework 段）

`agent`（max_cached）/ `skills`（scan_paths）/ `memory`（stm_window、ltm_*、compaction）/
`model`（context_window）/ `rag`（chunk_*、retrieval_top_k、embedder）/ `tool`（timeout_ms）/
`workspace`（base_path、contained、allowed_paths、timeout_ms、isolation）/ `checkpoint`（ttl_days）/
`storage`（thread/checkpoint 的 `memory`|`libsql`|`mysql`，vector 的 `memory`|`libsql`|`chroma`，
以及连接 token 名 `db_service`/`client_service`，默认 `db`/`client`）。

- 各领域 provider 在 `register` 阶段声明本领域配置段 schema（skills→`skills`，memory→`memory`/`rag`/`storage`，
  agent→`agent`）；无对应服务的 `model`/`tool`/`workspace`/`checkpoint` 由 `configProvider` 集中声明。
- `createVicoContainer` 装配顺序：逐个 `registerProvider`（声明 schema + 绑定服务）→ `setup` 回调（使用方注入连接 /
  注册应用层 provider）→ `load` 默认/用户配置 → `freeze`；因此其签名变为 async，且返回后容器已冻结。
- `@vico/di` 容器支持 `freeze()`：`resolve`/`resolveAsync` 首次调用自动冻结，冻结后禁止
  `register`/`registerValue`/`registerConfig`/`registerProvider`（抛 `Container is frozen`），保证依赖图在启动期定型。
- 默认值**只写在 `default.config.yaml`**，schema 的 `.default()` 仅兜底段内字段缺失，避免双写。
- 加载顺序：内置默认 → 用户 `configPath`（复用 `@vico/di` 的「后加载同名段整段覆盖先加载」语义）。
- 使用方扩展应用层配置：在 `setup` 回调内 `registerConfig`/`register`（须在 load/freeze 前完成），与 framework 段共存。

### 依赖装配（VicoTokens 真实类型）

`VicoTokens` 声明 framework 核心抽象（对应 packages/ 各子包）：

```
events: EventRecorder<TurnEvent>   thread: ThreadStore
checkpointStore: CheckpointStore   embedder: Embedder | undefined
vectorStore: VectorStore           memory: MemoryStore
skills: Skill[]                    agentRuntime: AgentRuntime
db: unknown（使用方注入）            client: unknown（使用方注入）
```

默认装配（`bootstrapVico` 后可直接 resolve）：

- `thread` / `checkpointStore` / `vectorStore`：后端由 `storage` 配置段驱动
  （thread/checkpoint 支持 `memory`/`libsql`/`mysql`，vector 支持 `memory`/`libsql`/`chroma`），
  默认均为 `memory`（`InMemoryThreadStore` / `MemoryCheckpointStore` / boot 自带的
  `InMemoryVectorStore`）。持久化后端的连接由使用方注入，其 token 名（service id）由
  `storage.db_service` / `storage.client_service` 指定（默认 `db`/`client`），boot 不建连接。
- `embedder`：由 `rag.embedder` 配置驱动，`"none"` 禁用（undefined），episodic 随之停用。
- `memory`：`conversation`（短时窗口）+ `episodic`（embedder 可用时启用）。
- `skills`：异步工厂（`createFSSkillLoader`），需 `resolveAsync`。
- `agentRuntime`：`AgentRuntime`，`max_cached` 来自 `agent` 配置段。

### Provider 约定

每个领域一个 `ServiceProvider` 对象，两阶段：

1. `register`：只做绑定（`c.register`），不实例化、不做副作用；
2. `boot`（可选）：所有 provider 注册完成后按声明顺序调用，此时可安全 resolve 依赖、执行异步初始化。

依赖拓扑（provider 注册顺序的自然依据）：

```
skills → thread/checkpointStore/vectorStore → embedder → memory
       → events → agentRuntime
```

## 迁移 server（后续）

- `config.ts` 的 framework 段 → `config/schemas/` + `default.config.yaml`（已就绪）
- `vico.ts` 的 `Vico` 类（已 `@deprecated`）→ `agent-provider.ts` 的 `agentRuntime`
- `memory-setup.ts` / `embedder.ts` → `memory-provider.ts`
- skill 扫描加载 → `skills-provider.ts`
- server 保留：`server`/`auth`/`database`/`storage`/`upload` 配置段、`app.ts` + `serve`

## 验证

- `pnpm --filter @vico/boot typecheck` 通过
- `pnpm --filter @vico/boot test` 通过（默认配置加载、用户覆盖、段内字段兜底、两阶段时序、真实装配、存储后端选择、service id 配置 12 个用例）
- `vico/server` `tsc --noEmit` 通过（`@deprecated` 不破坏现有 `vico.ts` 用法）
