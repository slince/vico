"use client";

// 1. Third-party
import { useEffect, useState } from "react";
import { useAui, type LanguageModelConfig } from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  FolderLockIcon,
  ShieldCheckIcon,
  UnlockIcon,
  type LucideIcon,
} from "lucide-react";

// 2. UI components
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// 3. Hooks
import { useChat } from "@/providers/chat-provider";

/** 审批政策模式取值（与 @vico/core 的 ApprovalMode 一致） */
type ApprovalMode = "approve-all" | "readonly" | "workspace" | "full-access";

/** 单个审批政策模式的展示元数据 */
interface ApprovalModeOption {
  id: ApprovalMode;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** 四个内置审批政策模式（由严到宽排序） */
const APPROVAL_MODES: ApprovalModeOption[] = [
  {
    id: "approve-all",
    label: "审查模式",
    description: "任何工具都需要审批",
    icon: ShieldCheckIcon,
  },
  {
    id: "readonly",
    label: "只读模式",
    description: "只读工具自动通过，修改需审批",
    icon: EyeIcon,
  },
  {
    id: "workspace",
    label: "工作区内修改",
    description: "工作区内完全权限，越界需审批",
    icon: FolderLockIcon,
  },
  {
    id: "full-access",
    label: "完全权限",
    description: "不做任何审批直接通过",
    icon: UnlockIcon,
  },
];

/** 默认审批政策模式：工作区内修改（最贴合编码 Agent 的工作区语义） */
const DEFAULT_MODE: ApprovalMode = "workspace";

/**
 * 携带审批政策模式的 modelContext config。
 * approvalMode 不是 LanguageModelConfig 的既定字段，但会随 config 一并透传至服务端。
 */
type ApprovalModeConfig = LanguageModelConfig & { approvalMode?: ApprovalMode };

/**
 * 审批政策模式选择器 — 内嵌在 thread composer action 中。
 *
 * 选中值通过 assistant-ui 的 modelContext 机制随请求注入 body.config.approvalMode，
 * 由服务端解析为 run 级审批策略（覆盖 agent 默认 resolver 链）。
 * 仅在 Chat 路由下渲染（Agent 详情页测试区不显示）。
 */
export function ApprovalModeSelectorAction() {
  const { isChatRoute } = useChat();
  const api = useAui();
  const [mode, setMode] = useState<ApprovalMode>(DEFAULT_MODE);

  // 将当前模式注册进 modelContext，与 ModelSelector 的 config 浅合并后随请求下发
  useEffect(() => {
    return api.modelContext.register({
      getModelContext: () => {
        const config: ApprovalModeConfig = { approvalMode: mode };
        return { config };
      },
    });
  }, [api, mode]);

  // 非 Chat 路由（如 Agent 详情页测试区）不展示选择器
  if (!isChatRoute) return null;

  const current = APPROVAL_MODES.find((m) => m.id === mode) ?? APPROVAL_MODES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="approval-mode-trigger"
          aria-label="审批政策模式"
          className={cn(
            "border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex h-8 max-w-36 items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-1",
          )}
        >
          <current.icon className="size-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {current.label}
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
            <CommandGroup>
              {APPROVAL_MODES.map((option) => {
                const selected = option.id === mode;
                return (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => setMode(option.id)}
                    className="gap-2.5 rounded-lg px-2.5 py-2"
                  >
                    <option.icon className="size-3.5 shrink-0 opacity-60" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">
                        {option.label}
                      </span>
                      <span className="text-muted-foreground truncate text-[11px]">
                        {option.description}
                      </span>
                    </div>
                    {selected && (
                      <CheckIcon className="size-4 shrink-0" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
