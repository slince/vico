// @vico/boot - checkpoint 配置段

import { z } from 'zod';

/** checkpoint 版本链 TTL 配置 */
export const checkpointSchema = z.object({
  ttl_days: z.number().default(30),
});
