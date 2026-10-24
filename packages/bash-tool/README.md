# @vico/bash-tool

Bash 持久会话执行工具，基于 `@vico/tool` 的 `createTool` 框架实现。

支持长运行命令的超时与会话管理（run / poll / write / stop 操作），工作目录为工作区根目录，会话超时 10 分钟自动清理。

## 快速使用

```ts
import { bashTool, codingTools } from '@vico/bash-tool';

// 单独使用
const tools = [bashTool];

// 与其他内置工具组合
import { basicTools } from '@vico/tool';
import { filesystemTools } from '@vico/fs-tool';
const all = [...basicTools, ...filesystemTools, ...codingTools];
```

## 相关文档

- [bash-tool 包拆分](../../docs/insights/bash-tool-package-split.md)
