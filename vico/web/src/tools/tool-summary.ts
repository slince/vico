/**
 * 工具 RunActivity 摘要的类型定义。
 *
 * 每个工具用它把「在 RunActivity 一行里展示什么」描述出来：行首图标、
 * 标题（缺省用工具名）、描述（关键参数摘要）。由 tools/tool-activity.ts
 * 注册表聚合后，交给 MessageRunActivity 消费渲染。
 */
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
