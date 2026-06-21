// @vico/agent - ToolSpec, ToolCall, ToolResult Zod schemas
import { z } from 'zod';

/** 工具审批策略 */
export const ToolPolicySchema = z.enum(['auto', 'on-request', 'suggest', 'never']);
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

/** 工具类别 */
export const ToolKindSchema = z.enum(['readonly', 'command', 'file_change', 'delegate', 'mutation']);
export type ToolKind = z.infer<typeof ToolKindSchema>;

/** 工具规格定义（发给 LLM 的 tool description） */
export const ToolSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  policy: ToolPolicySchema.default('auto'),
  kind: ToolKindSchema.default('readonly'),
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

/** LLM 返回的工具调用 */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** 工具执行结果 */
export const ToolResultSchema = z.object({
  callId: z.string(),
  name: z.string(),
  status: z.enum(['success', 'error']),
  output: z.unknown(),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
