"use client";

// 1. Hooks / Stores
import { useAgentSelection } from "@/stores/agent-selection";

// 2. UI / 子组件
import { ContextDisplay } from "@/components/assistant-ui/elements/context-display.aui";

/**
 * Composer 动作区中的上下文用量指示器。
 *
 * 与顶部工具栏的 ContextDisplay.Ring 同源：读取当前选中 Agent 的上下文窗口
 * （llm.context_window），配合 useThreadTokenUsage 累计本轮已用 token，
 * 在 composer 左侧动作区渲染一个环形百分比指示器（hover 展开用量明细）。
 * 未配置上下文窗口时返回 null，不占位。
 */
export function ContextDisplayAction() {
  const selectedAgent = useAgentSelection((s) => s.selectedAgent);
  const contextWindow = selectedAgent?.llm?.context_window;

  if (!contextWindow || contextWindow <= 0) return null;

  return <ContextDisplay.Ring modelContextWindow={contextWindow} />;
}
