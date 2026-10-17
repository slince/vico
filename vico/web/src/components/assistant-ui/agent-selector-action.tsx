"use client";

// 1. React
import { useEffect } from "react";

// 2. Third-party
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAui, type LanguageModelConfig } from "@assistant-ui/react";
import { Bot, CheckIcon, ChevronDownIcon } from "lucide-react";

// 3. API / Hooks
import { api } from "@/api/client";
import { useChat } from "@/providers/chat-provider";
import { useThread } from "@/hooks/use-thread";
import { useAgentSelection } from "@/stores/agent-selection";

// 4. UI components
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// 5. 类型
import type { Agent } from "@/types/models";

/** 携带 agentId 的 modelContext config，随请求透传 body.config.agentId */
type AgentConfig = LanguageModelConfig & { agentId?: string };

/**
 * Agent 选择器 — 内嵌在 thread composer action 中，决定本次会话使用的 Agent。
 *
 * 选中值通过 assistant-ui 的 modelContext 机制随请求注入 body.config.agentId，
 * 由服务端解析为本次对话的 Agent（预创建线程时也读同一份选中态）。
 * 不再驱动 runtime 重建：选择后仅更新 composer 选中态与请求 config。
 * 仅在 Chat 路由的新会话（尚无 threadId）下渲染：已有会话的详情页不展示，
 * 由线程绑定的 Agent 决定本次对话（Agent 详情页的测试对话区同样不显示）。
 */
export function AgentSelectorAction() {
  const { isChatRoute, threadId } = useChat();
  const { t } = useTranslation("threads");
  const aui = useAui();
  const selectedAgent = useAgentSelection((s) => s.selectedAgent);
  const setSelectedAgent = useAgentSelection((s) => s.setSelectedAgent);

  // Agent 列表仅在 Chat 路由下请求
  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
    enabled: isChatRoute,
  });
  const agentList = agents ?? [];

  // URL 中的 threadId 对应线程（用于恢复该线程的 Agent）
  const { data: thread } = useThread(threadId || undefined);

  // 同步选中 Agent：有线程时取该线程的 Agent；新会话回退默认 Agent
  useEffect(() => {
    if (!isChatRoute || agentList.length === 0) return;

    if (threadId && thread?.agentId) {
      if (selectedAgent?.id !== thread.agentId) {
        const agent = agentList.find((a) => a.id === thread.agentId);
        if (agent) setSelectedAgent(agent);
      }
      return;
    }

    if (!threadId && !selectedAgent) {
      const defaultAgent =
        agentList.find((a) => a.is_default === 1) ?? agentList[0];
      if (defaultAgent) setSelectedAgent(defaultAgent);
    }
  }, [isChatRoute, agentList, threadId, thread?.agentId, selectedAgent, setSelectedAgent]);

  // 将当前选中 Agent 注册进 modelContext，与 ModelSelector 的 config 浅合并后随请求下发
  useEffect(() => {
    if (!isChatRoute) return;
    return aui.modelContext.register({
      getModelContext: () => {
        const config: AgentConfig = { agentId: selectedAgent?.id };
        return { config };
      },
    });
  }, [aui, isChatRoute, selectedAgent?.id]);

  // 非 Chat 路由（如 Agent 详情页测试区）或已有会话详情页不展示切换器，
  // 仅在新建会话时允许选择 Agent
  if (!isChatRoute || threadId) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="agent-selector-trigger"
          aria-label={t("selectAgent")}
          className={cn(
            "border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex h-8 max-w-40 cursor-pointer items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-1",
          )}
        >
          <Bot className="size-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {selectedAgent?.name ?? t("selectAgent")}
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-64 overflow-hidden rounded-xl p-0"
      >
        <Command>
          <CommandList>
            <CommandEmpty>{t("chatSidebarEmpty")}</CommandEmpty>
            <CommandGroup>
              {agentList.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={agent.id}
                  keywords={[agent.name]}
                  onSelect={() => setSelectedAgent(agent)}
                  className="gap-2 rounded-lg px-2.5 py-2"
                >
                  <Bot className="size-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  {selectedAgent?.id === agent.id && (
                    <CheckIcon className="size-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
