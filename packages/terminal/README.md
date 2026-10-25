# @vico/terminal

终端会话管理层：维护 pty 进程与 headless 屏幕（@xterm/headless）的保活生命周期。

`TerminalSessionManager` 只认不透明的 `sessionKey`（由调用方拼接，不感知 thread / terminal 领域概念），通过 `createSession / getSession / destroySession` 管理会话生命周期；`session` 句柄驱动 `attach / handleMessage / detach / destroy`。工作目录（`cwd`）与日志（`logger`）均由调用方注入。

## 快速使用

```ts
import { TerminalSessionManager } from '@vico/terminal';

const manager = new TerminalSessionManager(logger);

// sessionKey 的语义完全由调用方定义（如 `${threadId}:${terminalId}`）
const session = manager.createSession('thread-1:terminal-a');
manager.getSession('thread-1:terminal-a');  // => session
manager.destroySession('thread-1:terminal-a');

// WebSocket 连接建立 / 消息 / 关闭
const ok = session.attach({ send }, { cwd: '/path/to/workspace' });
session.handleMessage(rawData);
session.detach({ send });
```

推送帧协议：`snapshot`（完整屏幕回放）/ `output`（增量输出）/ `exit`（进程退出，携带退出码）。
