// @vico/boot - 记忆配置段（短期窗口 / 长期抽取 / 上下文压缩）

import { z } from 'zod';

/** 上下文压缩配置（snake_case，对齐 CompactionSettings 原字段） */
export const memoryCompactionSchema = z.object({
  auto: z.boolean().optional(),
  threshold_ratio: z.number().optional(),
  headroom_tokens: z.number().optional(),
  retain_ratio: z.number().optional(),
  retain_tokens: z.number().optional(),
  summarization_provider: z.string().optional(),
  summarization_model: z.string().optional(),
  max_tokens: z.number().optional(),
  compaction_retries: z.number().optional(),
  max_overflow_retries: z.number().optional(),
});

/** 记忆配置（短期窗口 / 长期抽取 / 上下文压缩 / 语义记忆后端） */
export const memorySchema = z.object({
  stm_window: z.number().default(20),
  ltm_auto_extract: z.boolean().default(true),
  ltm_max_entries: z.number().default(10000),
  /** 语义记忆后端：none 不启用，libsql 用 LibSqlSemanticMemory（需注入 db） */
  semantic: z.enum(['none', 'libsql']).default('none'),
  compaction: memoryCompactionSchema.optional(),
});
