# @vico/boot

Vico **Agent Framework** 启动层：把 framework 的「配置定义」与「启动流程」沉淀成约定俗成的写法。

- 依赖 `@vico/di`（工厂 Provider + 配置加载 + ServiceProvider 两阶段启动）
- 配置按领域拆分为多段 zod schema，内置默认值唯一来源是 `src/config/default.config.yaml`
- 领域逻辑以 `ServiceProvider` 形式组织：`register` 只绑定依赖，`boot` 执行初始化副作用

> **边界**：只涵盖 framework 自身能力（`packages/` 下各子包）。应用层专属功能
> （HTTP 服务、认证、数据库连接、文件存储/上传等）不在本包内，由使用方自行扩展。
>
> 当前为**骨架阶段**：结构完整，provider 内部以 TODO 标注迁移点，暂未接入 server。

## 目录结构

```
src/
├── config/
│   ├── schemas/          # 7 个配置段 zod schema（按领域拆分，字段级 .default() 兜底）
│   │   └── index.ts      # 聚合导出
│   ├── default.config.yaml  # 内置默认配置（默认值唯一来源）
│   ├── keys.ts           # VicoConfigKeys（段名 → schema 类型）
│   └── types.ts          # VicoConfig（各段 z.infer 合并）
├── tokens.ts             # VicoTokens（token 名 → 实例类型）+ 容器/provider 类型别名
├── providers/            # 领域 provider（register 绑定 + boot 副作用）
│   ├── skills-provider.ts
│   ├── memory-provider.ts
│   └── agent-provider.ts
├── bootstrap.ts          # createVicoContainer / bootstrapVico
└── index.ts              # 导出
```

## 用法

```ts
import { bootstrapVico, createVicoContainer } from '@vico/boot';

// 一键启动（内置默认配置，可用 configPath 覆盖）
const container = await bootstrapVico({ configPath: './vico.config.yaml' });

// 或分步：先建容器（注册配置段 + 加载配置），再 bootstrap
const c = createVicoContainer();
c.getConfig('rag').embedder; // 'openai/text-embedding-3-small'
await c.bootstrap(vicoProviders);
```

## 约定

### 配置

- 每个领域一段 schema（`skills`/`memory`/`model`/`rag`/`tool`/`workspace`/`checkpoint`），
  通过 `registerConfig` 注册。
- 默认值**只写在 `default.config.yaml`**，schema 的 `.default()` 仅兜底段内字段缺失，
  避免两处双写。
- 加载顺序：内置默认 → 用户 `configPath`（后加载同名段整段覆盖先加载）。
- 使用方扩展应用层配置：继续在容器上 `registerConfig('server', serverSchema)` 并 `load`，
  与 framework 段共存。

### Provider

每个领域一个 `ServiceProvider` 对象，遵循两阶段：

1. `register`：只做绑定（`c.register`），不实例化、不做副作用；
2. `boot`（可选）：所有 provider 注册完成后按声明顺序调用，此时可安全 resolve
   依赖、执行异步初始化（预热、起定时器等）。

依赖拓扑（provider 注册顺序的自然依据）：

```
skills → thread/checkpointStore/vectorStore → embedder → memory
       → toolExecutor → agentRuntime
```

## 迁移 server（后续）

把 `vico/server` 的 framework 相关装配迁移进来，应用层专属装配留在 server：

- `config.ts` 的 framework 段 → `config/schemas.ts` + `default.config.yaml`（已就绪）
- `vico.ts` 的 `Vico` 类（已 `@deprecated`）→ `agent-provider.ts` 的 `agentRuntime`
- `memory-setup.ts` / `embedder.ts` → `memory-provider.ts`
- skill 扫描加载 → `skills-provider.ts`
- server 保留：`server`/`auth`/`database`/`storage`/`upload` 配置段、`app.ts` + `serve`
