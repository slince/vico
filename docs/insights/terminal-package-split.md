# terminal 包拆分

把 `vico/server/src/lib/terminal-manager.ts` 的 `TerminalManager` 下沉到公共底层包 `packages/terminal`（包名 `@vico/terminal`），server 改为依赖 `@vico/terminal`。

## 背景

`TerminalManager` 是线程工作目录终端的会话管理器（pty 保活 + headless 屏幕回放 + 空闲回收）。提取时做了「垂类」化：管理器只认不透明的 `sessionKey`，`threadId` / `terminalId` 等上层概念全部上移到调用方。

## 包结构与公共 API

- `packages/terminal/src/terminal-manager.ts`：
  - `TerminalManager`：按 sessionKey 维护会话注册表，`session(key)` 懒创建句柄。
  - `TerminalSession`：单个会话句柄，持有 pty + headless 屏幕 + follower 连接，驱动 `attach / handleMessage / detach`。
  - 导出类型：`TerminalFollower`、`TerminalFrame`（snapshot / output / exit）、`TerminalAttachOptions`。
- 依赖随类迁移：`@lydell/node-pty`（pty 进程）、`@xterm/headless` + `@xterm/addon-serialize`（headless 屏幕 + 序列化回放，CJS 经 `createRequire` 加载）、`pino`（`Logger` 类型）。

## 职责边界

- 调用方（server 的 ws 路由）负责：拼接 `sessionKey`（`${threadId}:${terminalId}`）、解析工作目录（`getThreadWorkspace`）。
- `@vico/terminal` 只负责：按 key 保活 pty 会话、屏幕回放、输入转发、空闲回收。

## server 接入方式

```ts
// vico/server/src/providers/services-provider.ts
c.register('terminalManager', ({ get }) => new TerminalManager(get('logger')));
```

```ts
// vico/server/src/api/ws/terminal.ts
const session = terminalManager.session(`${threadId}:${terminalId}`);
// onOpen: const cwd = await getThreadWorkspace(threadId); await session.attach(ws, { cwd });
// onMessage: session.handleMessage(...)
// onClose: session.detach(ws)
```

其余引用点：

- `tokens.ts`：`import type { TerminalManager } from '@vico/terminal'`

## 依赖变化

- `vico/server`：删除 `@lydell/node-pty`、`@xterm/headless`、`@xterm/addon-serialize`；新增 `@vico/terminal: workspace:*`。
- `@vico/terminal`：新增上述三个终端运行时依赖 + `pino`。
