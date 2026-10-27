# @vico/bash-tool

Shell 命令执行工具（bash / pwsh），基于 `@vico/tool` 的 `createTool` 框架实现。

本包是薄壳：保留工具 schema 与元数据（name / description / policy / kind / tags），
实际命令解析与进程派发全部委托给 `@vico/bash`（`parseCommand` + `CommandExecutor`）。

## 快速使用

```ts
import { bashTool, createShellTool } from '@vico/bash-tool';

// 单独使用 bash 工具
const tools = [bashTool];

// 选择当前主机合适的 shell 工具（Windows 无 Git Bash 时用 pwsh，否则用 bash）
const shell = createShellTool();
```

## 注入自定义执行器

```ts
import { createBashTool } from '@vico/bash-tool';
import { LocalCommandExecutor } from '@vico/bash';

const tool = createBashTool({
  executor: new LocalCommandExecutor({ command: '/bin/zsh', args: (c) => ['-c', c] }),
});
```

## 相关文档

- [bash-tool 包拆分](../../docs/insights/bash-tool-package-split.md)
