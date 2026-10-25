# @vico/bash-ssh

通过 SSH 在远程主机执行命令的 `CommandExecutor` 适配器。

消费 `@vico/bash` 的 `Command` / `CommandResult` / `CommandExecutor` 抽象，基于 [`ssh2`](https://github.com/mscdex/ssh2) 建立并复用一条 SSH 连接，把结构化命令序列化为远端 shell 命令行（env 前缀 + `cd` + `raw`）后执行，收集 stdout / stderr 与退出码。

## 快速使用

```ts
import { SshCommandExecutor } from '@vico/bash-ssh';

const ssh = new SshCommandExecutor({
  host: '10.0.0.8',
  username: 'deploy',
  privateKey: '/home/me/.ssh/id_ed25519',
});

const result = await ssh.execute(parseCommand('ls -la', { cwd: '/www' }));
await ssh.dispose();
```

## 模块

- `buildRemoteCommand(command)`：将 `Command` 序列化为远端命令行（`export KEY=VALUE; ` + `cd <cwd> && ` + `raw`），无 env / cwd 时仅输出 `raw`。
- `SshCommandExecutor`：惰性建立并复用 `ssh2.Client` 连接，执行并收集 stdout / stderr / 退出码，`timeout` 到点关闭 channel，`dispose()` 关闭连接。
