# @vico/fs

文件系统抽象层。

定义 `Filesystem` 端口（读/写/列目录/建目录/stat/unlink），默认提供 `LocalFilesystem`（本地磁盘，基于 `node:fs/promises`）。业务代码只依赖 `Filesystem` 端口，将来可平滑替换为 S3 / 内存等适配器。

## 快速使用

```ts
import { localFilesystem } from '@vico/fs';

const text = await localFilesystem.readTextFile('/path/to/file.md');
await localFilesystem.writeFile('/path/to/out.txt', 'hello');
const entries = await localFilesystem.readDir('/path/to/dir');
```

需要替换实现时，向已有的工厂 / 构造器注入自定义 `Filesystem` 实例；装配层（`@vico/boot` 的 `filesystem` token）默认提供 `localFilesystem`，可在该处统一切换适配器。
