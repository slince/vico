"use client";

// 1. UI / 子组件
import {
  ComposerContext,
  type ComposerUsage,
} from "@/components/assistant-ui/elements/composer";
import { useThreadTokenUsage } from "@/components/assistant-ui/utils/use-thread-token-usage";

// 后端暂未上报 system/tool 独立口径，先硬编码占位（k 单位，1 = 1k）
const SYSTEM_PROMPT_TOKENS = 1;
const TOOL_SCHEMA_TOKENS = 3;
const MODEL_CONTEXT_WINDOW = 200;

/** ComposerContext 按千位展示（12 渲染为 12k），此处把原始 token 数折算为 k 单位 */
function toK(tokens: number): number {
  return tokens / 1000;
}

/**
 * Composer 动作区中的上下文用量指示器。
 *
 * 复用 composer.tsx 里的 ComposerContext（环形按钮 + hover 展开用量面板）。
 * system/tools/total 暂为硬编码占位，messages 取当前线程实际已用 token
 * （useThreadTokenUsage，与顶部工具栏同源）。
 */
export function ContextDisplayAction() {
  const usage = useThreadTokenUsage();

  const composerUsage: ComposerUsage = {
    system: SYSTEM_PROMPT_TOKENS,
    tools: TOOL_SCHEMA_TOKENS,
    messages: toK(usage?.totalTokens ?? 0),
    total: MODEL_CONTEXT_WINDOW,
  };

  return <ComposerContext usage={composerUsage} />;
}
