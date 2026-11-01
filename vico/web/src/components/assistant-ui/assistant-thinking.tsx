"use client";

import {useEffect, useState} from "react";
import {ThinkingIndicator} from "./elements/thinking-indicator";
import {useAuiState} from "@assistant-ui/react";

function useThinkingLabel() {
  return useAuiState((s) => {
    if (s.message.status?.type !== "running") return undefined;
    const pending = s.message.parts.find(
      (part) => part.type === "tool-call" && part.result === undefined,
    );
    if (pending?.type === "tool-call") return `Running ${pending.toolName}`;
    return s.message.parts.length === 0 ? "Thinking" : undefined;
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

export function AssistantThinking() {
  const label = useThinkingLabel();
  const elapsed = useElapsedLabel(label !== undefined);
  if (label === undefined) return null;
  return <ThinkingIndicator label={label} elapsed={elapsed} />;
}