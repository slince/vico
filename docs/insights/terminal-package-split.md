# terminal 包拆分

把 `vico/server/src/lib/terminal-manager.ts` 的 `TerminalManager` 下沉到公共底层包 `packages/terminal`（包名 `@vico/terminal`），server 改为依赖 `@vico/terminal`。

## 背景

`TerminalManager` 是线程工作目录终端的会话管理器（pty 保活 + headless 屏幕回放 + 空闲回收）。提取时做了「垂类」化：管理器只认不透明的 `sessionKey`，`threadId` / `terminalId` 等上层概念全部上移到调用方；并更名为 `TerminalSessionManager`，会话生命周期显式化为 create / get / destroy。

## 包结构与公共 API

- `packages/terminal/src/terminal-session-manager.ts`：
  - `TerminalSessionManager`：按 sessionKey 维护会话注册表，提供 `createSession(key)` / `getSession(key)` / `destroySession(key)`。
- `packages/terminal/src/terminal-session.ts`：
  - `TerminalSession`：单个会话句柄，持有 pty + headless 屏幕 + follower 连接，驱动 `attach / handleMessage / detach / destroy`。
  - 导出类型：`TerminalFollower`、`TerminalFrame`（snapshot / output / exit）、`TerminalAttachOptions`。
- 依赖随类迁移：`@lydell/node-pty`（pty 进程）、`@xterm/headless` + `@xterm/addon-serialize`（headless 屏幕 + 序列化回放，CJS 经 `createRequire` 加载）、`pino`（`Logger` 类型）。

## 职责边界

- 调用方（server 的 ws 路由）负责：拼接 `sessionKey`（`${threadId}:${terminalId}`）、解析工作目录（`getThreadWorkspace`）。
- `@vico/terminal` 只负责：按 key 管理会话生命周期（创建/获取/销毁）、pty 保活、屏幕回放、输入转发、空闲回收。

## server 接入方式

```ts
// vico/server/src/providers/services-provider.ts
c.register('terminalSessionManager', ({ get }) => new TerminalSessionManager(get('logger')));
```

```ts
// vico/server/src/api/ws/terminal.ts
const session = sessionManager.createSession(`${threadId}:${terminalId}`);
// onOpen: const cwd = await getThreadWorkspace(threadId); session.attach(ws, { cwd });
// onMessage: session.handleMessage(...)
// onClose: session.detach(ws)
```

REST 控制面（显式关闭终端）：

```ts
// vico/server/src/api/terminal.ts
app.delete('/api/v1/threads/:threadId/terminal/:terminalId', ...);
// getSession 校验存在 → destroySession 销毁（并广播 exit 给在线连接）
```

其余引用点：

- `tokens.ts`：`import type { TerminalSessionManager } from '@vico/terminal'`，token `terminalSessionManager`。

## 依赖变化

- `vico/server`：删除 `@lydell/node-pty`、`@xterm/headless`、`@xterm/addon-serialize`；新增 `@vico/terminal: workspace:*`。
- `@vico/terminal`：新增上述三个终端运行时依赖 + `pino`。
