# 轻应用托管（Light Apps）

> 让 Vico 从项目根目录 `apps/` 发现、安装并运行第三方轻应用：前端走 Vite 构建产物静态托管，后端以 Hono 子 app 注入路由，数据由应用自管（如 SQLite）。

## 能力概览

- 应用中心：`/apps` 页面列出全部扫描到的轻应用，支持安装 / 卸载 / 启用 / 禁用；只有「已安装且已启用」的应用可点击打开。
- 应用运行页：`/apps/:appId`，用 iframe 加载应用前端（`/app-static/<id>/`），与应用自身的样式/路由隔离。
- 后端注入：应用 `server` 入口导出 `setup(subApp, ctx)`，vico 挂载到 `/api/apps/<id>/*`，同源携带 session cookie。
- 应用数据：`ctx.dataDir = <apps.data_dir>/<appId>`，应用自行创建 SQLite 等存储，vico 不接管数据库结构。

> 路径解析：`~` 展开为家目录；相对路径以 `vico/server` 包根目录为基准（与启动 cwd 无关）。

## 应用协议

```
apps/<app-id>/
├── app.json           # 清单，id 必须与目录名一致
├── index.html         # 前端入口
├── src/               # Vite + TS 源码
├── server/index.js    # 可选后端入口（也可用 .ts/.mjs）
└── dist/              # 前端构建产物
```

`app.json`：

```json
{
  "id": "snake-demo",
  "name": "贪吃蛇",
  "version": "1.0.0",
  "description": "…",
  "icon": "🐍",
  "tags": ["游戏"],
  "frontend": { "dist": "dist", "entry": "index.html" },
  "server": { "entry": "server/index.js" },
  "dev": { "url": "http://localhost:5180" }
}
```

- `frontend.dist` 默认 `dist`，入口默认 `index.html`；vite 构建建议 `base: './'`。
- `server.entry` 缺省时按 `server/index.ts`、`server/index.mjs`、`server/index.js` 顺序探测。
- `dev.url` 仅在前端未构建时作为 iframe 回退地址（应用自己的 vite dev server 需把 `/api` 代理到 vico 3001）。

后端契约（无需依赖 vico 内部包）：

```js
export default async function setup(app, ctx) {
  // app: vico 注入的 Hono 子实例
  // ctx.dataDir: 应用私有持久目录
  // ctx.logger: 带 appId 绑定的 pino logger
  app.get('/scores', (c) => c.json([]));
}
```

## 服务端实现

| 模块 | 路径 | 职责 |
|------|------|------|
| 配置 | `vico/server/src/config/schemas.ts`、`server.config.yaml` | `apps.scan_paths`（默认 `../../apps`，相对 `vico/server` 包根目录，即仓库根 `apps/`）、`apps.data_dir`（默认 `~/vico/app-data`） |
| 管理器 | `vico/server/src/apps/app-manager.ts` | 清单扫描校验、安装状态读写、子 app 懒加载、静态托管；由 `services-provider` 注册为容器服务 `appManager`（注入 db / apps 配置 / logger），路由通过 `getContainer().get('appManager')` 取用 |
| 路由 | `vico/server/src/api/apps.ts` | `/api/v1/apps*` 管理接口、`/api/apps/<id>/*` 分发、`/app-static/<id>/*` 静态 |
| 表 | `vico/server/src/db/schema.ts` + `drizzle/0016_light_apps.sql` | `light_apps`（id/installed/enabled/时间戳） |
| 构建 CLI | `vico/server/src/apps/build.ts` | `pnpm app:build [appId]` 在应用目录执行 `pnpm build` |

关键设计：**稳定分发 + 懒加载**。根 app 只注册一次 `/api/apps/:appId/*`，每次请求按 id 查安装状态并委托给应用子 app，因此安装/禁用/卸载即时生效，无需修改 Hono 路由表。子 app 按入口文件 mtime 缓存，改代码后下一次请求自动重新 import（dev 下由 tsx 支持 `.ts`；生产环境建议应用提供 `.js/.mjs`）。

## 权限

- 列表 / 打开 / 静态资源：任意已登录用户。
- 安装 / 卸载 / 启用 / 禁用：`admin`。安装状态是服务端全局状态，非管理员在界面上不展示写操作按钮。

## 安全边界

- 应用后端与 vico 同进程运行，属于**可信本地应用**模型：应用代码拥有进程内全部能力（文件系统、环境变量、数据库）。只应安装可信来源的应用。
- 静态托管做了目录穿越防护（目标必须位于应用 `dist` 内）；应用 API 走 vico 的 session 鉴权。
- 应用之间通过独立 `dataDir` 隔离数据目录，但未做 OS 级隔离。

## 示例：贪吃蛇

`apps/snake-demo`：

- 前端 Vite + TS 手写 canvas 游戏，`base: './'` 适配 `/app-static/snake-demo/`。
- 后端 `server/index.js` 使用 Node 内置 `node:sqlite`，在 `ctx.dataDir/scores.db` 建排行榜。
- 构建：`pnpm app:build snake-demo`（或在应用目录 `pnpm build`）。

## 后续可扩展

- 应用权限清单（声明需要的 FS 路径、环境变量，运行时校验）。
- 独立进程/沙箱运行后端，避免同进程信任边界。
- 应用级资源配额、日志隔离与卸载时数据清理策略。
