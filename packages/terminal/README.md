# @vico/terminal

终端会话管理层：维护 pty 进程与 headless 屏幕（@xterm/headless）的保活生命周期。

`TerminalManager` 只认不透明的 `sessionKey`（由调用方拼接，不感知 thread / terminal 领域概念）；`session(key)` 返回会话句柄，调用方驱动 `attach / handleMessage / detach`。工作目录（`cwd`）与日志（`logger`）均由调用方注入。

## 快速使用

```ts
import { TerminalManager } from '@vico/terminal';

const manager = new TerminalManager(logger);

// sessionKey 的语义完全由调用方定义（如 `${threadId}:${terminalId}`）
const session = manager.session('thread-1:terminal-a');

// WebSocket 连接建立 / 消息 / 关闭
const ok = await session.attach({ send }, { cwd: '/path/to/workspace' });
session.handleMessage(rawData);
session.detach({ send });
```

推送帧协议：`snapshot`（完整屏幕回放）/ `output`（增量输出）/ `exit`（进程退出，携带退出码）。
