# 贪吃蛇 · Vico 轻应用示例

一个最小但完整的 vico 轻应用：

- **前端**：Vite + TypeScript（无框架），构建产物在 `dist/`
- **后端**：`server/index.js` 导出 `setup(app, ctx)`，自带 Node `node:sqlite` 排行榜
- **数据**：由 vico 提供私有目录 `ctx.dataDir`，应用自己在里面建 `scores.db`

## 目录

```
snake-demo/
├── app.json           # 应用清单（id 必须与目录名一致）
├── index.html
├── src/               # 前端源码
├── server/index.js    # 应用后端（注入到 /api/apps/snake-demo/）
├── vite.config.ts     # base: './'，适配 vico 的静态托管路径
└── dist/              # 构建产物（vico 从 /app-static/snake-demo/ 读取）
```

## 开发

```bash
pnpm install
pnpm dev        # 应用前端 http://localhost:5180（/api 代理到 vico 3001）
pnpm build      # 生成 dist
```

也可以在 vico 仓库根目录执行 `pnpm app:build snake-demo` 统一构建。

## 后端契约

```js
export default async function setup(app, ctx) {
  // app：vico 注入的 Hono 子实例，在这里注册应用路由
  // ctx.dataDir：应用私有数据目录（已创建）
  // ctx.logger：带 appId 的日志器
}
```

前端通过 `/api/apps/snake-demo/*` 访问应用自己的接口；只有应用在 vico 应用中心
安装并启用后，路由与静态页面才可访问。
