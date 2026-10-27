// @vico/boot - 工具装配（内置 + 文件系统 + coding + 语义记忆 + skill 工具）

import { createShellTool } from '@vico/bash-tool';
import { browserTools } from '@vico/browser-tool';
import { filesystemTools } from '@vico/fs-tool';
import { createUpdateSemanticMemoryTool, type SemanticMemory } from '@vico/memory';
import { createSkillTools, type Skill } from '@vico/skill';
import { basicTools, type Tool } from '@vico/tool';

/** 工具配置项：工具数组 + 按名启停（config 中标记为 false 的被移除） */
export type ToolSetting<T extends Tool[] = Tool[]> = {
  tools: T;
  config?: Partial<Record<T[number]['name'], boolean>>;
};

/** 工具装配输入：纯数组，或 { tools, config } 对象模式（支持按名关闭） */
export type ToolOptions = Tool[] | ToolSetting;

/**
 * 组装工具列表：内置工具 + 额外工具 + semantic memory 工具 + skill 工具。
 *
 * @param toolsOption - 额外工具（数组模式）或 { tools, config } 对象模式（可手动关闭工具）
 * @param semanticMemory - 语义记忆（存在时追加语义记忆更新工具）
 * @param skills - Skill 列表（存在时追加 skill 工具）
 * @returns 组装完成的工具列表
 */
export function buildTools(
  toolsOption: ToolOptions | undefined,
  semanticMemory: SemanticMemory | undefined,
  skills: Skill[] | undefined,
): Tool[] {
  const extraTools = Array.isArray(toolsOption) ? toolsOption : (toolsOption?.tools ?? []);
  const toolConfig = Array.isArray(toolsOption) ? undefined : toolsOption?.config;
  const allTools: Tool[] = [...basicTools, ...filesystemTools, createShellTool(), ...browserTools, ...extraTools];
  if (semanticMemory) {
    allTools.push(createUpdateSemanticMemoryTool(semanticMemory));
  }
  if (skills) {
    allTools.push(...createSkillTools(skills));
  }
  // 对象模式下支持按名称关闭工具（config 中标记为 false 的被移除）
  return toolConfig ? allTools.filter(t => toolConfig[t.name]) : allTools;
}
