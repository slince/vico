// @vico/boot - 文件系统领域 provider（默认工作空间 + 文件系统实现）

import { localFilesystem } from '@vico/fs';
import { resolveWorkspacePath } from '@vico/utils';
import { fsSchema } from '../config/schemas/index.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 文件系统 provider：声明 `fs` 配置段 schema，并注册两个服务——
 *
 * - `workspace`：默认工作空间（`fs.base_path` 展开 `~` 并解析为绝对路径）；
 * - `filesystem`：文件系统实现（由 `fs.filesystem_backend` 驱动，当前仅 `local`）。
 *
 * Agent 未单独指定 workspace 时，server 层从 `workspace` 取默认值兜底；fs 工具组从
 * `filesystem` 取实现注入，未来扩展 S3 / 内存等适配器时只需在此按配置切换。
 */
export const fsProvider: VicoServiceProvider = {
  register(c) {
    c.registerConfig('fs', fsSchema);

    // '.' 作为目标路径即取 workspace 根目录本身，复用 @vico/utils 的 ~ 展开 + 绝对化逻辑
    c.register('workspace', ({ getConfig }) => resolveWorkspacePath(getConfig('fs').base_path, '.'));

    c.register('filesystem', ({ getConfig }) => {
      const backend = getConfig('fs').filesystem_backend;
      switch (backend) {
        case 'local':
        default:
          return localFilesystem;
      }
    });
  },
};
