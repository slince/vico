# @vico/bash

Shell 命令解析与执行抽象层。

将一行 shell 命令解析为结构化 `Command`（按 `&&` / `||` / `;` / `|` 拆分为多个 `CommandSegment`，每个段再词法化为 command / flags / args / targets），供后续任务（命令分析、执行、阻断）复用。零运行时依赖。

## 快速使用

```ts
import { parseCommand } from '@vico/bash';

const c = parseCommand('rm -rf /www/xxx && ls -n', { cwd: '/tmp' });

c.segments[0].command;  // 'rm'
c.segments[0].flags;    // ['-r', '-f']
c.segments[0].targets;  // ['/www/xxx']
c.segments[1].operator; // 'and'
c.timeout;              // 120000（缺省）
```

## 解析约定

- 拆段顺序 `&&` → `||` → `;` → `|`（先长后短），仅拆分引号外、未被反斜杠转义的运算符。
- 词法化识别单引号 / 双引号 / 反斜杠，引号内的分隔符与空白不拆分。
- 首 token 记作 `command`；`-` 开头的 token 记作 flag（`-rf` 拆为 `-r` / `-f`，`--flag=value` 整体保留）；其余记作 arg。
- arg 中形如路径者（`/`、`./`、`../`、`~` 开头或含 `/`）同时进入 `targets`。
- `$(...)`、反引号、`>` 仅作为原样 token 保留，不做展开或重定向解析。
- 空白命令退化为单段空 `command`，不抛异常。
