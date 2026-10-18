// @vico/boot - 日志配置段

import { z } from 'zod';

/** 日志配置（pino level） */
export const loggerSchema = z.object({
  level: z.string().default('info'),
});
