// @vico/boot - Skill 扫描配置段

import { z } from 'zod';

/** Skill 扫描配置 */
export const skillsSchema = z.object({
  scan_paths: z.array(z.string()).default([]),
  compatible: z.boolean().default(false),
});
