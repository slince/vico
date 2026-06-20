// @vico/agent - SSEEvent and SpanType Zod schemas
import { z } from 'zod';

export const SpanTypeSchema = z.enum([
  'agent_run',
  'model_step',
  'tool_call',
  'memory_retrieval',
  'rag_search',
  'skill_activation',
  'context_compaction',
]);
export type SpanType = z.infer<typeof SpanTypeSchema>;

export const SSEEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), content: z.string() }),
  z.object({ type: z.literal('reasoning_delta'), content: z.string() }),
  z.object({ type: z.literal('tool_call_start'), id: z.string(), name: z.string() }),
  z.object({ type: z.literal('tool_call_delta'), id: z.string(), args: z.string() }),
  z.object({ type: z.literal('tool_result'), id: z.string(), name: z.string(), status: z.enum(['success', 'error']), output: z.unknown() }),
  z.object({ type: z.literal('step_start'), step: z.number() }),
  z.object({ type: z.literal('step_end'), step: z.number() }),
  z.object({ type: z.literal('compacted'), removedTokens: z.number() }),
  z.object({ type: z.literal('approval_request'), callId: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('done'), usage: z.object({ input: z.number(), output: z.number() }).optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SSEEvent = z.infer<typeof SSEEventSchema>;
