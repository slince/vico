/**
 * 工具 RunActivity 摘要与扩展工具定义的类型定义。
 *
 * ToolRunActivitySummary / ToolSummarizer 描述「工具在 RunActivity 一行里展示什么」。
 * VicoToolkitDefinitionEntry 在 assistant-ui 的 ToolkitDefinitionEntry 之上扩展
 * summarize 字段，让每个工具在声明处即可自述摘要。所有工具经 tools/toolkit.ts
 * 的 defineToolkit 聚合，MessageRunActivity 按 part.toolName 直接取用 render/summarize。
 */
import type { ToolkitDefinitionEntry } from "@assistant-ui/react";
import type { LucideIcon } from "lucide-react";

/** 单个工具在 RunActivity 里的一行摘要 */
export type ToolRunActivitySummary = {
  /** 行首图标，缺省回退 WrenchIcon */
  icon?: LucideIcon;

  /** 标题，缺省用工具名 */
  title?: string;

  /** 描述：关键参数摘要（如 bash 的 command、文件工具的 path） */
  description?: string;
};

/** 由工具 args 折叠出 RunActivity 摘要的函数 */
export type ToolSummarizer<TArgs = Record<string, unknown>> = (
  args: TArgs,
) => ToolRunActivitySummary;

/**
 * Vico 自定义的工具定义项 —— 在 assistant-ui 的 ToolkitDefinitionEntry 基础上
 * 扩展 summarize，使工具在声明处即可自述 RunActivity 摘要。
 */
export type VicoToolkitDefinitionEntry<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = ToolkitDefinitionEntry<TArgs, TResult> & {
  /** 把工具调用折叠成 RunActivity 里的一行摘要；缺省由 MessageRunActivity 回退 */
  summarize?: ToolSummarizer<TArgs>;
};
