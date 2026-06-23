// @vico/agent - Convert Vico Tool[] to LanguageModelV3FunctionTool[]
import type { LanguageModelV3FunctionTool } from '@ai-sdk/provider';
import type { ToolDescriptor } from './types.js';

/**
 * Convert Vico ToolDescriptor[] to provider-level LanguageModelV3FunctionTool[].
 */
export function convertTools(tools: ToolDescriptor[]): LanguageModelV3FunctionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as LanguageModelV3FunctionTool['inputSchema'],
  }));
}
