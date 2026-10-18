// @vico/boot - RAG 配置段（分块 / 检索 / 嵌入器）

import { z } from 'zod';

/** RAG 配置（embedder 为字符串名或结构化配置对象） */
export const ragSchema = z.object({
  chunk_size: z.number().default(512),
  chunk_overlap: z.number().default(64),
  retrieval_top_k: z.number().default(5),
  embedder: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .default('openai/text-embedding-3-small'),
});
