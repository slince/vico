# vico/server 应用层配置容器化 — 移除 config.ts

## 背景

前一步 `server-boot-adoption.md` 把 framework 段配置（skills/thread/checkpoint/vector…）交给 boot 容器后，
`config.ts` 仍保留应用层专属段的「手写 interface + 手工 merge 默认值 + 模块级单例」：`loadConfig()` 读
yaml 后逐段 `{...default, ...parsed}` 合并，导出 `config` 单例供 `app.ts`/`index.ts`/`db`/`knowledge` 等
直接 import。这种「配置段一半在容器、一半在模块级单例」的割裂，本次一并收敛：**删除 `config.ts`，
应用层配置段同样走容器的 `registerConfig` + `load`，schema 定义注入 provider。**

## 关键决策

### 1. `createVicoContainer` 泛型化，允许使用方扩展配置段

`@vico/boot` 的 `createVicoContainer` 原返回 `Container<undefined, VicoTokens, VicoConfigKeys>`，ConfigKeys
固定为 9 个 framework 段，使用方无法注册新段（类型层面 `registerConfig` 只认 `VicoConfigKeys` 的 key）。

改为泛型签名：

```ts
export function createVicoContainer<
  TConfigKeys extends VicoConfigKeys = VicoConfigKeys,
>(options?: { configPath?: string }): Container<undefined, VicoTokens, TConfigKeys>
```

server 侧定义 `interface ServerConfigKeys extends VicoConfigKeys` 追加 5 个应用层段，得到
`ServerContainer = Container<undefined, VicoTokens, ServerConfigKeys>`。framework 段的注册在
createVicoContainer 内部以 `VicoConfigKeys` 视角完成（`registerConfig` 的 schema 参数处于逆变位置，
泛型视角下 TS 无法校验，故用局部 `as unknown as Container<..., VicoConfigKeys>` 断言——两种视角下
framework 段 schema 类型完全一致，断言安全）。

### 2. schema 定义注入 provider

新建 `src/config/schemas.ts`，用 zod 定义 5 段（`server`/`auth`/`database`/`file_storage`/`upload`），
默认值由 schema `.default()` 兜底；`serverProvider.register` 阶段逐个 `registerConfig` 注册进容器。
`server.config.yaml` 顶层已有的同名段在 `load` 时即被验证。

### 3. 时序处理（两处）

删除模块级 `config` 单例后，`database.url` 只能在容器 `load` 之后读取，而旧代码有两处「容器可用前」的
提前消费，分别处理：

- **auth 模块加载即建实例** → 改为懒加载 `getAuth()`：`betterAuth` 初始化会调用 `getDb()`，`getDb()`
  依赖容器 database 配置，故不能模块级创建。`app.ts` 里 3 处 `auth.xxx` 改为 `getAuth().xxx`（均在
  请求处理回调内，容器已就绪）。
- **boot 阶段建表需要 `getDb()`** → `setContainer` 提前到 `createVicoContainer` 之后、`bootstrap`
  之前。这样 `serverProvider.boot`（迁移/建表）里 `getDb()` 读 `getConfig('database')` 可用。

### 4. 工具函数与常量去向

`config.ts` 里与配置无关/仅单点消费的导出分散到各自归属处：

| 符号 | 去向 |
|------|------|
| `CONFIG_PATH` | 移到 `bootstrap.ts`（唯一消费点） |
| `expandHome` | 移到 `lib/path.ts`（纯路径工具） |
| `getRagConfig`/`RagConfig` | 内联到 `memory/rag.ts`，直接 `getConfig('rag')` 读 `chunk_size`/`chunk_overlap`（原 rerank/no_match/query_rewrite 字段为死代码，一并删除） |
| `AppConfig` | 由 `ServerConfigKeys` + 各段 schema 的 `z.infer` 取代 |

## 消费点变更清单

| 文件 | 变更 |
|------|------|
| `packages/boot/src/bootstrap.ts` | `createVicoContainer` 泛型化（`TConfigKeys extends VicoConfigKeys`） |
| `src/config.ts` | **删除** |
| `src/config/schemas.ts`（新） | 5 段 zod schema + `ServerConfigKeys`/`ServerContainer`/`ServerServiceProvider` |
| `src/bootstrap.ts` | `CONFIG_PATH` 内联；`serverProvider.register` 注册 5 段；`setContainer` 提前 |
| `src/container.ts` | 类型改为 `ServerContainer`；注释说明「createVicoContainer 后即 set」 |
| `src/db/init-libsql.ts` | `config.database.url` → `getContainer().getConfig('database').url` |
| `src/auth/index.ts` | `export const auth` → 懒加载 `getAuth()` |
| `src/app.ts` | `auth` → `getAuth()`；`config.server.deploy_mode` → `getConfig('server')` |
| `src/index.ts` | `config.server.*` → `getConfig('server')`；`Variables` 改 any（auth 实例化延后） |
| `src/services/knowledge/knowledge-manager.ts` | `config.upload` → `getConfig('upload')` |
| `src/services/knowledge/storage-manager.ts` | `config.file_storage` → `getConfig('file_storage')` |
| `src/services/agent/agent-manager.ts` | `expandHome` 改从 `lib/path.js` 导入 |
| `src/memory/rag.ts` | 删 `getRagConfig`，直接 `getConfig('rag')` |

## 验证

- `vico/server` `npx tsc --noEmit` 通过（exit 0）
- `@vico/boot` `tsc --noEmit` 通过、`vitest run` 12/12 通过
- 运行期由用户验证：`pnpm dev` 启动、登录、聊天、知识库、文件浏览（本次仅改配置装配路径，行为不变）
