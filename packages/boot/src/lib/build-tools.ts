// @vico/boot - 工具装配（内置 + 文件系统 + shell + 语义记忆 + skill 工具）

import { createShellTool } from '@vico/bash-tool';
import { browserTools } from '@vico/browser-tool';
import { createFilesystemTools } from '@vico/fs-tool';
import type { Filesystem } from '@vico/fs';
import { createUpdateSemanticMemoryTool, type SemanticMemory } from '@vico/memory';
import { createSkillTools, type Skill } from '@vico/skill';
import { basicTools, type Tool } from '@vico/tool';

/** 工具装配选项：文件系统实现 + 额外工具 + 可选装配开关 */
export interface BuildToolsOptions {
  /** 文件系统实现（fs 工具组注入用） */
  filesystem: Filesystem;
  /** 额外工具（如应用层 weatherTool） */
  extraTools?: Tool[];
  /** 按名启停（config 中标记为 false 的被移除） */
  config?: Partial<Record<string, boolean>>;
  /** 语义记忆（存在时追加语义记忆更新工具） */
  semanticMemory?: SemanticMemory;
  /** Skill 列表（存在时追加 skill 工具） */
  skills?: Skill[];
}

/**
 * 组装工具列表：内置 + 文件系统 + shell + 语义记忆 + skill 工具。
 *
 * 文件系统实现由调用方注入（boot 容器提供 `filesystem` token），不再默认本地文件系统。
 *
 * @param options - 装配选项
 * @returns 组装完成的工具列表
 */
export function buildTools(options: BuildToolsOptions): Tool[] {
  const { filesystem, extraTools = [], config, semanticMemory, skills } = options;
  const allTools: Tool[] = [
    ...basicTools,
    ...createFilesystemTools(filesystem),
    createShellTool(),
    ...browserTools,
    ...extraTools,
  ];
  if (semanticMemory) {
    allTools.push(createUpdateSemanticMemoryTool(semanticMemory));
  }
  if (skills) {
    allTools.push(...createSkillTools(skills));
  }
  // 按名启停：config 中标记为 false 的被移除
  return config ? allTools.filter((t) => config[t.name]) : allTools;
}
