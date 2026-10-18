// @vico/boot - Skill 扫描路径配置段

import { z } from 'zod';

/** Skill 扫描路径配置 */
export const skillsSchema = z.object({
  scan_paths: z.array(z.string()).default([]),
});
