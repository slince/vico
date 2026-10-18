// @vico/boot - Vico 聚合配置类型（各段 z.infer 后的合并）

import type { z } from 'zod';
import type { VicoConfigKeys } from './keys.js';

/** Vico 聚合配置：段名 → 该段 schema 的解析结果类型 */
export type VicoConfig = {
  [K in keyof VicoConfigKeys]: z.infer<VicoConfigKeys[K]>;
};
