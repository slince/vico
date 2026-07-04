/**
 * Vico 平台 ToolKit — 聚合所有工具定义。
 *
 * 每个工具完整定义（schema、类型、render、display）在其独立的 .tool.ts 文件中，
 * 此处仅做 defineToolkit 组装。
 */
import {defineToolkit} from '@assistant-ui/react';
import {getWeatherTool} from './get-weather.tool';
import {bashTool} from './bash.tool';
import {knowledgeSearchTool} from './knowledge-search.tool';

export const toolkit = defineToolkit({
  'get-weather': getWeatherTool,
  bash: bashTool,
  search_knowledge_base: knowledgeSearchTool,
});
