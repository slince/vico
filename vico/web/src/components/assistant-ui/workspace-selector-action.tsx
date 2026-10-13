"use client";

// 1. React
import { useEffect, useState } from "react";

// 2. Third-party
import { useTranslation } from "react-i18next";
import { useAui, type LanguageModelConfig } from "@assistant-ui/react";
import { ChevronDownIcon, Folder } from "lucide-react";

// 3. UI / 子组件
import { cn } from "@/lib/utils";
import { FolderPickerDialog } from "@/components/file-explorer/FolderPickerDialog";

// 4. Hooks
import { useChat } from "@/providers/chat-provider";

/** 携带 workspace 的 modelContext config（随请求透传 body.config.workspace） */
type WorkspaceConfig = LanguageModelConfig & { workspace?: string };

/** 取绝对路径最后一段作为展示名 */
function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Workspace 选择器 — 新会话时显示在 composer 上方，用于绑定本次会话的工作目录。
 *
 * 选择后通过 modelContext 注入 config.workspace，随首次消息下发给服务端，
 * 由服务端在创建 thread 时写入 thread.metadata.workspace。
 * 仅在 Chat 路由且尚未创建真实线程（threadId 为空）时渲染。
 */
export function WorkspaceSelectorAction() {
  const { threadId, isChatRoute } = useChat();
  const api = useAui();
  const { t } = useTranslation("threads");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // 将当前选择的工作区注册进 modelContext，随请求下发 body.config.workspace
  useEffect(() => {
    return api.modelContext.register({
      getModelContext: () => {
        const config: WorkspaceConfig = { workspace: workspace ?? undefined };
        return { config };
      },
    });
  }, [api, workspace]);

  // 仅在 Chat 路由且新会话（尚未有真实 threadId）时展示
  if (!isChatRoute || threadId) return null;

  return (
    <>
      <button
        type="button"
        data-slot="workspace-selector-trigger"
        aria-label={t("selectWorkspace")}
        onClick={() => setOpen(true)}
        className={cn(
          "border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex h-8 max-w-44 items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-1",
        )}
      >
        <Folder className="size-3.5 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {workspace ? basename(workspace) : t("selectWorkspace")}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
      </button>

      <FolderPickerDialog
        threadId={null}
        open={open}
        onOpenChange={setOpen}
        initialPath={null}
        onSelect={(path) => {
          setWorkspace(path);
          setOpen(false);
        }}
      />
    </>
  );
}
