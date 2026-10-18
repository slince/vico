// @vico/boot - 纯配置段 provider（无对应服务的 framework 配置段 schema 声明）

import {
  checkpointSchema,
  modelSchema,
  toolSchema,
  workspaceSchema,
} from '../config/schemas/index.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 配置 provider：声明未被任何领域服务工厂消费的 framework 配置段 schema。
 *
 * model / tool / workspace / checkpoint 这些段没有对应的 boot 服务，仅由 server 层
 * 或更上层按需 getConfig 读取；集中在此注册，保证 createVicoContainer 加载默认
 * 配置后这些段能通过 schema 验证。
 */
export const configProvider: VicoServiceProvider = {
  register(c) {
    c
      .registerConfig('model', modelSchema)
      .registerConfig('tool', toolSchema)
      .registerConfig('workspace', workspaceSchema)
      .registerConfig('checkpoint', checkpointSchema);
  },
};
