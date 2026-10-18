// @vico/boot - Agent 运行时配置段

import { z } from 'zod';

/** Agent 运行时配置（LRU 缓存上限） */
export const agentSchema = z.object({
  max_cached: z.number().default(50),
});
