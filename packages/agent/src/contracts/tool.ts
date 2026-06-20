import { z } from 'zod';

export const ToolPolicySchema = z.enum(['auto', 'on-request', 'suggest', 'never']);

export const ToolKindSchema = z.enum(['readonly', 'command', 'file_change', 'delegate']);

export const ToolDefSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  policy: ToolPolicySchema,
  kind: ToolKindSchema,
});

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

export const ToolResultSchema = z.object({
  callId: z.string(),
  output: z.string(),
  isError: z.boolean().optional(),
});
