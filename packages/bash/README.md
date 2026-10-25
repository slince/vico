# @vico/bash

Shell 命令解析、分析、拦截策略与执行抽象层。零运行时依赖。

将一行 shell 命令解析为结构化 `Command`（按 `&&` / `||` / `;` / `|` 拆分为多个 `CommandSegment`，每个段再词法化为 command / flags / args / targets），再交给 `analyzeCommand` 产出分类、风险与安全 findings，可选通过 `InterceptionPolicy` 拦截，最终由可插拔的 `CommandExecutor`（内置 `LocalCommandExecutor` 真实派发子进程）执行。

## 快速使用

```ts
import { parseCommand, analyzeCommand } from '@vico/bash';

const c = parseCommand('rm -rf /www/xxx && ls -n', { cwd: '/tmp' });

c.segments[0].command;  // 'rm'
c.segments[0].flags;    // ['-r', '-f']
c.segments[0].targets;  // ['/www/xxx']
c.segments[1].operator; // 'and'
c.timeout;              // 120000（缺省）

const analysis = analyzeCommand(c);
analysis.findings;      // 含 delete-command（critical）、unknown-command 等
```

## 模块

- `parseCommand`：将一行 shell 命令解析为结构化 `Command`。
- `analyzeCommand` / `COMMAND_REGISTRY`：将 `Command` 分析为类别、风险与安全 findings。
- `permissivePolicy` / `withPolicy`：拦截策略（放行兜底）与执行器包装。
- `CommandExecutor` / `LocalCommandExecutor` / `localCommandExecutor`：可插拔执行器抽象与本地实现。

## 解析约定

- 拆段顺序 `&&` → `||` → `;` → `|`（先长后短），仅拆分引号外、未被反斜杠转义的运算符。
- 词法化识别单引号 / 双引号 / 反斜杠，引号内的分隔符与空白不拆分。
- 首 token 记作 `command`；`-` 开头的 token 记作 flag（`-rf` 拆为 `-r` / `-f`，`--flag=value` 整体保留）；其余记作 arg。
- arg 中形如路径者（`/`、`./`、`../`、`~` 开头或含 `/`）同时进入 `targets`。
- 重定向运算符（`>` / `>>` / `<` / `2>` / `2>&1` / `&>` 等）记入 `redirects`，运算符与目标均不进 `args` / `targets`。
- `$(...)`、反引号仅作为原样 token 保留，不做展开。
- 空白命令退化为单段空 `command`，不抛异常。
