// @vico/boot - 日志领域 provider（结构化日志实例）

import pino from 'pino';
import { loggerSchema } from '../config/schemas/index.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 日志 provider：声明 `logger` 配置段 schema，注册 `logger` 实例（pino）。
 *
 * 非生产环境启用 pino-pretty 友好输出；各领域 provider 的 boot 副作用与
 * server 层均可从容器 `resolve('logger')` 取用统一的结构化日志实例。
 */
export const loggerProvider: VicoServiceProvider = {
  register(c) {
    c.registerConfig('logger', loggerSchema);

    c.register('logger', ({ getConfig }) =>
      pino({
        level: getConfig('logger').level,
        transport: process.env.NODE_ENV === 'production' ? undefined : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }));
  },
};
