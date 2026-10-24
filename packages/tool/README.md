# @vico/tool

工具框架与基础内置工具。

提供 Tool 定义、ToolExecutor 执行器、审批策略，以及 web_fetch、todo、ask_user 等基础内置工具（bash 拆分至 [@vico/bash-tool](../bash-tool/README.md)、文件系统拆分至 [@vico/fs-tool](../fs-tool/README.md)、浏览器拆分至 [@vico/browser-tool](../browser-tool/README.md)）。

## 快速使用

```ts
import { z } from 'zod';
import { createTool } from '@vico/tool';

// 用 Zod schema 定义参数，execute 前自动校验 call.args
const echo = createTool({
  name: 'echo',
  description: 'Echo back the input',
  inputSchema: z.object({ message: z.string() }),
  execute: async (args) => args.message,
});

// 内置工具直接组合使用（bash / 文件系统 / 浏览器分别从各自包导入）
import { basicTools } from '@vico/tool';
import { codingTools } from '@vico/bash-tool';
import { filesystemTools } from '@vico/fs-tool';
import { browserTools } from '@vico/browser-tool';
const tools = [...basicTools, ...filesystemTools, ...codingTools, ...browserTools];
```

## 相关文档

- [ask_user 工具协议](../../docs/insights/tool-ask-user-protocol.md)
