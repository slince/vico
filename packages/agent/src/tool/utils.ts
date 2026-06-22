import type { Tool as VicoTool } from './types.js';

/** Vico Tool[] 转为 AI SDK tools 格式 */
export function toAISDKTools(tools: VicoTool[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const tool of tools) {
    result[tool.name] = { description: tool.description, inputSchema: tool.inputSchema };
  }
  return result;
}
