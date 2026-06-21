/** 知识库表行类型 */
export interface KnowledgeBaseRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  source: string;
  skill_name: string | null;
  chunk_count: number;
  created_at: number;
}

import { z } from 'zod';

export const createKbSchema = z.object({
  name: z.string().min(1, '知识库名称不能为空'),
  description: z.string().optional().default(''),
});

export type CreateKbInput = z.infer<typeof createKbSchema>;

export const updateKbSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export type UpdateKbInput = z.infer<typeof updateKbSchema>;
