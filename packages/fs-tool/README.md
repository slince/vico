# @vico/fs-tool

文件系统操作工具集合，基于 `@vico/tool` 的 `createTool` 框架与 `@vico/fs` 文件系统抽象层实现。

包含 `read` / `write` / `edit` / `glob` / `grep` 五个工具，工作目录为工作区根目录，底层文件操作经 `Filesystem` 端口（默认 `localFilesystem`），可注入替代实现。

## 快速使用

```ts
import { filesystemTools } from '@vico/fs-tool';

// 与其他内置工具组合
import { basicTools } from '@vico/tool';
import { codingTools } from '@vico/bash-tool';
const all = [...basicTools, ...filesystemTools, ...codingTools];

// 注入自定义文件系统实现
import { createReadTool } from '@vico/fs-tool';
const readTool = createReadTool(customFilesystem);
```

## 相关文档

- [文件系统抽象层](../../docs/insights/filesystem-abstraction-layer.md)
