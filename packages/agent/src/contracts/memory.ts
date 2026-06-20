// @vico/agent - MemoryRecord Zod schema
import { z } from 'zod';

export const MemoryRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  threadId: z.string().optional(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
