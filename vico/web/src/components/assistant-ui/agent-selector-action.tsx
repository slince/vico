"use client";

// 1. Third-party
import { useTranslation } from "react-i18next";
import { Bot, CheckIcon, ChevronDownIcon } from "lucide-react";

// 2. UI components
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

// 3. Hooks
import { useChat } from "@/providers/chat-provider";

/**
 * Agent 选择器 — 内嵌在 thread composer action 中，用于切换当前对话 Agent。
 *
 * 直接消费 ChatProvider 的 agents / selectedAgent / selectAgent，与全局
 * Sidebar 共享同一份状态；选择后通过 selectAgent 回到 /chat 并重建 runtime。
 * 仅在 Chat 路由下渲染（Agent 详情页的测试对话区不显示）。
 */
export function AgentSelectorAction() {
  const { agents, selectedAgent, selectAgent, isChatRoute } = useChat();
  const { t } = useTranslation("threads");

  // 非 Chat 路由（如 Agent 详情页测试区）不展示切换器
  if (!isChatRoute) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="agent-selector-trigger"
          aria-label={t("selectAgent")}
          className={cn(
            "border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex h-8 max-w-40 items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-1",
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
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={agent.id}
                  keywords={[agent.name]}
                  onSelect={() => selectAgent(agent)}
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
