// @vico/boot - 文件系统领域 provider（默认文件系统实现）

import { localFilesystem } from '@vico/fs';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 文件系统 provider：注册 `filesystem` 服务（默认本地文件系统单例）。
 *
 * 抽象层当前只有 `LocalFilesystem` 一个适配器；未来扩展 S3 / 内存等实现时，
 * 在此按配置切换，消费方（buildTools）无需感知具体实现。
 */
export const filesystemProvider: VicoServiceProvider = {
  register(c) {
    c.register('filesystem', () => localFilesystem);
  },
};
