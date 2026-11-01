"use client";

import {useEffect, useState} from "react";
import {useAuiState} from "@assistant-ui/react";
import {useTranslation} from "react-i18next";
import {toolkit} from "@/tools/toolkit";
import type {VicoToolkitDefinitionEntry} from "@/tools/tool-summary";
import {ThinkingIndicator} from "./elements/thinking-indicator";

/** toolkit 按工具名索引的类型视图（与折叠块内 ToolActivityContent 的消费方式一致） */
const tools = toolkit as Record<string, VicoToolkitDefinitionEntry | undefined>;

function useThinkingLabel() {
  const {t} = useTranslation("assistant");
  return useAuiState((s) => {
    if (s.message.status?.type !== "running") return undefined;
    const pending = s.message.parts.find(
      (part) => part.type === "tool-call" && part.result === undefined,
    );
    if (pending?.type === "tool-call") {
      // 优先展示工具 summarize 的 description（已含动作动词，如 "Reading …"），无摘要时兜底工具名
      const description = tools[pending.toolName]
        ?.summarize?.(pending.args)
        ?.description?.trim();
      return description || t("thinking.runningTool", {tool: pending.toolName});
    }
    // 只要 agent 还在运行就持续显示：有 pending 工具展示其 description，否则始终 "Thinking"
    return t("message.thinking");
  });
}

function useElapsedLabel(active: boolean) {
  const [label, setLabel] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!active) {
      setLabel(undefined);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setLabel(`${Math.round((Date.now() - start) / 1000)}s`);
    }, 1000);
    return () => clearInterval(id);
  }, [active]);
  return label;
}

export function AssistantThinking({className}: {className?: string}) {
  const label = useThinkingLabel();
  const elapsed = useElapsedLabel(label !== undefined);
  if (label === undefined) return null;
  return <ThinkingIndicator label={label} elapsed={elapsed} className={className} />;
}