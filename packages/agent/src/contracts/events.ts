import { z } from 'zod';

export const SSEEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), content: z.string() }),
  z.object({ type: z.literal('reasoning_delta'), content: z.string() }),
  z.object({ type: z.literal('tool_call'), callId: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('tool_result'), callId: z.string(), output: z.string(), isError: z.boolean().optional() }),
  z.object({ type: z.literal('step_start'), step: z.number() }),
  z.object({ type: z.literal('step_finish'), step: z.number() }),
  z.object({ type: z.literal('done'), finishReason: z.string(), usage: z.object({ input: z.number(), output: z.number() }) }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.string().optional() }),
]);
