# @vico/bash-tool

Shell 命令执行工具（bash / pwsh），基于 `@vico/tool` 的 `createTool` 框架实现。

本包是薄壳：保留工具 schema 与元数据（name / description / policy / kind / tags），
实际命令解析与进程派发全部委托给 `@vico/bash`（`parseCommand` + `CommandExecutor`）。

## 快速使用

```ts
import { bashTool, shellTools } from '@vico/bash-tool';

// 单独使用 bash 工具
const tools = [bashTool];

// 与其他内置工具组合（按平台选择 shell：Windows 用 pwsh，其余用 bash）
import { basicTools } from '@vico/tool';
const all = [...basicTools, ...shellTools];
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
