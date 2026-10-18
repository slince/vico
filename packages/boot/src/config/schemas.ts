// @vico/boot - Vico Agent Framework 的配置段 schema 定义（每段独立，字段级默认值兜底）

import { z } from 'zod';

/** Skill 扫描路径配置 */
export const skillsSchema = z.object({
  scan_paths: z.array(z.string()).default([]),
});

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

/** 记忆配置（短期窗口 / 长期抽取 / 上下文压缩） */
export const memorySchema = z.object({
  stm_window: z.number().default(20),
  ltm_auto_extract: z.boolean().default(true),
  ltm_max_entries: z.number().default(10000),
  compaction: memoryCompactionSchema.optional(),
});

/** 聊天模型全局默认上下文窗口 */
export const modelSchema = z.object({
  context_window: z.number().optional(),
});

/** RAG 配置（embedder 为字符串名或结构化配置对象） */
export const ragSchema = z.object({
  chunk_size: z.number().default(512),
  chunk_overlap: z.number().default(64),
  retrieval_top_k: z.number().default(5),
  embedder: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .default('openai/text-embedding-3-small'),
});

/** 工具执行超时配置 */
export const toolSchema = z.object({
  timeout_ms: z.number().default(30000),
});

/** Workspace 基础工具配置（文件读写、命令执行等） */
export const workspaceSchema = z.object({
  base_path: z.string().default('./workspace'),
  contained: z.boolean().default(true),
  allowed_paths: z.array(z.string()).default([]),
  timeout_ms: z.number().default(30000),
  isolation: z.enum(['none', 'seatbelt', 'bwrap']).default('none'),
});

/** checkpoint 版本链 TTL 配置 */
export const checkpointSchema = z.object({
  ttl_days: z.number().default(30),
});
