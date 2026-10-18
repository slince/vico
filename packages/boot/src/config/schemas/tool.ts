// @vico/boot - 工具执行配置段

import { z } from 'zod';

/** 工具执行超时配置 */
export const toolSchema = z.object({
  timeout_ms: z.number().default(30000),
});
