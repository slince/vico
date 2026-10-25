# @vico/terminal

终端会话管理层：维护 pty 进程与 headless 屏幕（@xterm/headless）的保活生命周期。

`TerminalManager` 负责终端进程的创建、复用、输入转发、断开回收与屏幕回放；路由层只做参数提取，不感知 pty / headless 细节。工作目录解析（`resolveWorkspace`）与日志（`logger`）均构造注入，与业务层解耦。

## 快速使用

```ts
import { TerminalManager } from '@vico/terminal';

const manager = new TerminalManager(
  async (threadId) => resolveThreadWorkspace(threadId), // cwd 解析
  logger, // pino
);

// WebSocket 连接建立 / 消息 / 关闭
const ok = await manager.attach(threadId, terminalId, { send });
manager.handleMessage(threadId, terminalId, rawData);
manager.detach(threadId, terminalId, { send });
```

推送帧协议：`snapshot`（完整屏幕回放）/ `output`（增量输出）/ `exit`（进程退出，携带退出码）。
