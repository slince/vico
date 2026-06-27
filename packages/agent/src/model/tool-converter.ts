// @vico/agent - 将 Vico ToolDescriptor[] 转换为 LanguageModelV3FunctionTool[]
import type { LanguageModelV3FunctionTool } from '@ai-sdk/provider';
import type { ToolDescriptor } from './types.js';

/**
 * 将 Vico 的 ToolDescriptor[] 转换为 provider 层的 LanguageModelV3FunctionTool[]。
 *
 * @param tools - Vico 工具描述符数组
 * @returns provider 层函数工具数组
 */
export function convertTools(tools: ToolDescriptor[]): LanguageModelV3FunctionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as LanguageModelV3FunctionTool['inputSchema'],
  }));
}
