# vico/server 业务 Service 注入容器 — 彻底 DI

## 背景

前两步已把「framework 段配置」「应用层配置段」收敛进 `@vico/boot`/`@vico/di` 容器，但业务服务层
（`agentManager`/`modelManager`/`threadManager`/`knowledgeManager`/`storageManager`/`documentManager`/
`ragManager`/`terminalManager`）仍是**模块级单例 + 类内直呼全局访问器**：`export const xxx = new Xxx()`，
方法里 `getDb()`/`getClient()`/`getContainer()`，服务间靠 `import` 单例；api 路由层 `import { xxx }` 直接消费。

本次按用户确认的**彻底层次**收敛：服务类全部改为 `export class` + **构造函数注入全部依赖**（含 db/client、
兄弟 service、配置切片），类内不再出现任何全局访问器；api 层经 `getContainer().get('xxx')` 取服务；
孤儿服务 `approvalService` 一并删除。

## 关键决策

### 1. `ServerTokens` 窄化 `db`/`client`（新建 `src/tokens.ts`）

`VicoTokens` 把 `db`/`client` 声明为 `unknown`（framework 不限定后端）。server 固定 libsql，在
`ServerTokens extends VicoTokens` 中窄化：

```ts
db: AppDb;      // LibSQLDatabase<typeof combinedSchema>（init-libsql.ts 新增导出）
client: Client; // @libsql/client
```

并追加业务 token：`auth`/`agentManager`/`modelManager`/`threadManager`/`knowledgeManager`/`storageManager`/
`documentManager`/`ragManager`/`terminalManager`/`weatherTool`/`llmProviders`。`ServerContainer`/
`ServerServiceProvider` 类型随之迁入 `tokens.ts`（泛型参数由 `VicoTokens` 换成 `ServerTokens`）。

**循环依赖规避**：`tokens.ts` 内所有依赖用 `import type`（`typeof` 查询），运行时零导入，
不与 `db → container` 链路成环。

### 2. 服务类构造函数注入（8 个类）

每个类去掉 `getDb()`/`getClient()`/`getContainer()` 与兄弟单例 import，改为构造参数：

| 类 | 构造签名 |
|---|---|
| `ModelManager` | `(db: AppDb)` |
| `DocumentManager` | `(db: AppDb)` |
| `StorageManager` | `(cfg: FileStorageConfig)` |
| `RAGManager` | `(db, client, vectorStore, embedder: Embedder \| undefined, ragConfig)` |
| `AgentManager` | `(db, modelManager, workspacePath)`（workspace 路径在 provider 里 `expandHome`） |
| `ThreadManager` | `(store: ThreadStore, agentManager)`（删除 `private get store()` getter） |
| `KnowledgeManager` | `(db, ragManager, documentManager, storageManager, uploadConfig)` |
| `TerminalManager` | `(resolveWorkspace: (threadId) => Promise<string>)` |

类内模块级常量（`const { agents } = schema`、`parserRegistry` 等）是纯表定义/纯对象，保留。

### 3. 装配（新建 `src/services-provider.ts`）

`servicesProvider.register` 用懒工厂按拓扑绑定（`get` 递归触发，注册顺序无关）：

```
db/client（bootstrap 注入）→ modelManager/documentManager/storageManager/ragManager
  → agentManager/threadManager/knowledgeManager → terminalManager
```

`bootstrap.ts` 把 `container` 断言为 `ServerContainer`（沿用 boot 内部同款 `as unknown as`），
`vicoProviders` 同理 cast 后与 `serverProvider`/`servicesProvider` 一起 `bootstrap`。

### 4. api 层消费点改造

统一模式：删除 `import { 单例 }`，handler 内先 `const xxx = getContainer().get('xxx')` **提前取好局部变量**，
再 `xxx.method(...)` 调用，不写 `getContainer().get('xxx').method(...)` 内联长链。涉及
`api/{agents,models,dashboard,threads,knowledge,providers,exec-approvals,users,observability}.ts`、
`api/ws/terminal.ts`、`agent/get-agent.ts`、`vico.ts`（`weatherTool`）、`app.ts`（`getAuth()` → `get('auth')`）。

**时序约束**：api 路由模块在 `bootstrap()` 前加载（`vico.ts` 模块级 `export const app = createApp()` →
`registerRoutes`），因此 `get()` **不能放在模块级或路由注册函数体内**（`getContainer()` 会抛「容器未初始化」），
只能放在请求期执行的 handler 内——handler 顶部提前 `get()` 是满足该时序约束的最靠前位置。

保留的薄适配层：`vico.ts` 的 `getThreadStore`/`getAgent`/`listSkills`、`workspace.ts` 的 `getThreadWorkspace`、
`auth/index.ts` 的 `getAuth()`（作为 `auth` token 的 factory）。

## 删除

- `src/services/approval/approval-service.ts`（孤儿服务，无消费点；`exec-approvals` 直接操作 `exec_approvals` 表）。

## 验证

- `vico/server` `npx tsc --noEmit` 通过（exit 0）。
- 运行期由用户验证：`pnpm dev` 启动、登录、聊天、知识库上传/预览、终端（仅改装配路径，行为不变）。
