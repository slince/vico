# @vico/fs-tool

文件系统操作工具集合，基于 `@vico/tool` 的 `createTool` 框架与 `@vico/fs` 文件系统抽象层实现。

包含 `read` / `write` / `edit` / `glob` / `grep` 五个工具，工作目录为工作区根目录。`read` / `write` / `edit` 的底层文件操作经 `Filesystem` 端口（**必填，由装配层注入**）；`glob` / `grep` 走打包的 ripgrep 二进制，不依赖文件系统。

## 快速使用

```ts
import { localFilesystem } from '@vico/fs';
import { createFilesystemTools } from '@vico/fs-tool';

// 一次性构建文件系统工具组（注入文件系统实现）
const filesystemTools = createFilesystemTools(localFilesystem);

// 单独构建某个工具
import { createReadTool } from '@vico/fs-tool';
const readTool = createReadTool(customFilesystem);
```

## 相关文档

- [文件系统抽象层](../../docs/insights/filesystem-abstraction-layer.md)
