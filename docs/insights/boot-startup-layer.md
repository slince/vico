# @vico/boot 启动层 —— framework 配置定义 + 启动流程的约定

## 背景

`vico/server` 的启动是「模块级单例 + 手工编排」：`config.ts` 手写 `AppConfig` 与默认值合并，`vico.ts` 持有全局 `vico`（`@vico/core` 的 `Vico` 类）与 `initVico()`，`index.ts` 的 `main()` 手工串 `runMigrations → seed → initVico → serve`。这套编排隐式、难测试、无法注入。

前序工作落地了 `@vico/di`（工厂 Provider + `registerConfig`/`load` 配置加载 + `ServiceProvider`/`bootstrap` 两阶段启动）。本任务把 framework 的「配置定义与启动流程」沉淀成约定：新建 `@vico/boot` 启动层，并标记 `Vico` 类废弃。

## 目标与边界

- `packages/agent/src/vico.ts` 的 `Vico` 类加 `@deprecated` 标记，指向 `@vico/boot` 替代方案（仅加注释，不改行为）。
- 新建 `packages/boot`（`@vico/boot`）：承载 framework 的配置段 schema、默认配置、领域 provider 骨架、`bootstrap` 入口。
- **只涵盖 framework 自身能力**（`packages/` 下各子包）。应用层专属功能——HTTP 服务（`server`）、认证（`auth`）、数据库连接（`database`）、文件存储/上传（`storage`/`upload`）——不属于 framework 范围，由使用方（`vico/server`）自行扩展。
- **暂不迁移 server**（`index.ts`/`vico.ts`/`config.ts` 现状不动），provider 骨架以 TODO 标注迁移点。

## 目录结构

```
packages/boot/src/
├── config/
│   ├── schemas.ts         # 7 个配置段 zod schema（字段级 .default() 兜底）
│   ├── default.config.yaml  # 内置默认配置（默认值唯一来源）
│   ├── keys.ts            # VicoConfigKeys（段名 → schema 类型）
│   └── types.ts           # VicoConfig（各段 z.infer 合并）
├── tokens.ts              # VicoTokens（token 名 → 实例类型）+ VicoContainer/VicoServiceProvider
├── providers/             # 领域 provider（register 绑定 + boot 副作用）
│   ├── skills-provider.ts
│   ├── memory-provider.ts
│   └── agent-provider.ts
├── bootstrap.ts           # createVicoContainer / bootstrapVico / vicoProviders
└── index.ts               # 导出
```

## 关键设计

### 配置约定（7 个 framework 段）

`skills`（scan_paths）/ `memory`（stm_window、ltm_*、compaction）/ `model`（context_window）/
`rag`（chunk_*、retrieval_top_k、embedder）/ `tool`（timeout_ms）/ `workspace`（base_path、
contained、allowed_paths、timeout_ms、isolation）/ `checkpoint`（ttl_days）。

- 默认值**只写在 `default.config.yaml`**，schema 的 `.default()` 仅兜底段内字段缺失，避免双写。
- 加载顺序：内置默认 → 用户 `configPath`（复用 `@vico/di` 的「后加载同名段整段覆盖先加载」语义）。
- 使用方扩展应用层配置：继续在容器上 `registerConfig('server', serverSchema)` 并 `load`，与 framework 段共存。

### Provider 约定

每个领域一个 `ServiceProvider` 对象，两阶段：

1. `register`：只绑定（`c.register`），不实例化、不做副作用；
2. `boot`（可选）：所有 provider 注册完成后按声明顺序调用，此时可安全 resolve 依赖、执行异步初始化。

依赖拓扑（provider 注册顺序的自然依据）：

```
skills → thread/checkpointStore/vectorStore → embedder → memory
       → toolExecutor → agentRuntime
```

### 容器类型

`VicoContainer = Container<undefined, VicoTokens, VicoConfigKeys>`：构造时不注入 config，
配置全部走 `registerConfig`/`load`。`VicoTokens` 只声明 framework 核心抽象
（`agentRuntime`/`memory`/`thread`/`checkpointStore`/`embedder`/`vectorStore`/
`skillRegistry`/`toolExecutor`），当前占位 `unknown`，迁移时替换为真实类型即获得类型安全。

## 迁移 server（后续）

- `config.ts` 的 framework 段 → `config/schemas.ts` + `default.config.yaml`（已就绪）
- `vico.ts` 的 `Vico` 类（已 `@deprecated`）→ `agent-provider.ts` 的 `agentRuntime`
- `memory-setup.ts` / `embedder.ts` → `memory-provider.ts`
- skill 扫描加载 → `skills-provider.ts`
- server 保留：`server`/`auth`/`database`/`storage`/`upload` 配置段、`app.ts` + `serve`

## 验证

- `pnpm --filter @vico/boot typecheck` 通过
- `pnpm --filter @vico/boot test` 通过（默认配置加载、用户覆盖、段内字段兜底、两阶段时序）
- `pnpm --filter @vico/di test` 通过（未破坏 di）
- `vico/server` `tsc --noEmit` 通过（`@deprecated` 不破坏现有 `vico.ts` 用法）
