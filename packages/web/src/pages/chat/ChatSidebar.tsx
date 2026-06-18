// 1. React
import { useCallback, useEffect } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useAuiState } from '@assistant-ui/react';
import { Bot } from 'lucide-react';

// 3. UI components
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ThreadList } from '@/components/assistant-ui/thread-list';

interface Agent {
  id: string;
  name: string;
}

interface ChatSidebarProps {
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  /** 线程切换时同步 URL */
  onThreadChange?: (threadId: string) => void;
}

/**
 * 监听 runtime 线程切换并同步到 URL。
 *
 * 必须在 AssistantRuntimeProvider 内部使用。
 */
function ThreadUrlSync({ onThreadChange }: { onThreadChange?: (threadId: string) => void }) {
  const threadId = useAuiState((s) => s.thread.threadId);

  useEffect(() => {
    if (threadId) {
      onThreadChange?.(threadId);
    }
  }, [threadId, onThreadChange]);

  return null;
}

/**
 * Chat 左侧面板 — 基于 ThreadListSidebar 结构：
 * Sidebar > SidebarHeader（Agent 选择器）+ SidebarContent（ThreadList）。
 *
 * 使用 assistant-ui 的 ThreadList 组件管理对话列表，
 * 替换原有的自定义对话列表和删除确认弹窗。
 */
export function ChatSidebar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onThreadChange,
}: ChatSidebarProps) {
  const { t } = useTranslation('conversations');

  const handleAgentChange = useCallback(
    (value: string) => {
      onSelectAgent(value);
    },
    [onSelectAgent],
  );

  return (
    <Sidebar className="border-r">
      <SidebarHeader className="mb-2 border-b px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <div className="flex items-center gap-2 w-full">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Bot className="size-4" />
                </div>
                <Select value={selectedAgentId || ''} onValueChange={handleAgentChange}>
                  <SelectTrigger className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0">
                    <SelectValue placeholder={t('selectAgent')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* 线程切换时同步 URL（仅在 AssistantRuntimeProvider 内可用） */}
        {onThreadChange && <ThreadUrlSync onThreadChange={onThreadChange} />}
      </SidebarHeader>

      <SidebarContent className="px-2">
        {/* ThreadList 需要 AuiProvider — 仅在 onThreadChange 传入时（即 Provider 内）渲染 */}
        {onThreadChange ? (
          <ThreadList />
        ) : (
          <div className="px-2.5 pt-3 text-xs text-muted-foreground">
            Select an agent to start chatting
          </div>
        )}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
