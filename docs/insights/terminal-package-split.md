# terminal 包拆分

把 `vico/server/src/lib/terminal-manager.ts` 的 `TerminalManager` 下沉到公共底层包 `packages/terminal`（包名 `@vico/terminal`），server 改为依赖 `@vico/terminal`。

## 背景

`TerminalManager` 是线程工作目录终端的会话管理器（pty 保活 + headless 屏幕回放 + 空闲回收）。它已是纯构造注入（`resolveWorkspace`、`logger`），与 server 业务层解耦，适合下沉为公共底层能力。

## 包结构与公共 API

- `packages/terminal/src/terminal-manager.ts`：原 `TerminalManager` 类，逻辑不变。
- `packages/terminal/src/index.ts`：对外导出 `TerminalManager`、`type TerminalFollower`、`type TerminalFrame`；`TerminalSession` 保持内部不导出。
- 依赖随类迁移：`@lydell/node-pty`（pty 进程）、`@xterm/headless` + `@xterm/addon-serialize`（headless 屏幕 + 序列化回放，CJS 经 `createRequire` 加载）、`pino`（`Logger` 类型）。

## server 接入方式

`resolveWorkspace`（工作目录解析）是 server 特有逻辑，留在 `vico/server/src/lib/workspace.ts`，经 DI 注入：

```ts
// vico/server/src/providers/services-provider.ts
c.register('terminalManager', ({ get }) => new TerminalManager(getThreadWorkspace, get('logger')));
```

其余引用点：

- `tokens.ts`：`import type { TerminalManager } from '@vico/terminal'`
- `api/ws/terminal.ts`：仅通过 `getContainer().get('terminalManager')` 使用，无直接 import

## 依赖变化

- `vico/server`：删除 `@lydell/node-pty`、`@xterm/headless`、`@xterm/addon-serialize`；新增 `@vico/terminal: workspace:*`。
- `@vico/terminal`：新增上述三个终端运行时依赖 + `pino`。
