// 1. React
import {useCallback, useEffect} from 'react';

// 2. Third-party
import {useTranslation} from 'react-i18next';
import {useAuiState} from '@assistant-ui/react';
import {Bot} from 'lucide-react';

// 3. UI components
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {ThreadList} from '@/components/assistant-ui/thread-list';

interface Agent {
  id: string;
  name: string;
}

interface ChatSidebarProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent) => void;
  /** 线程切换时同步 URL */
  onThreadChange?: (threadId: string) => void;
}

/**
 * 监听 runtime 线程切换并同步到 URL。
 *
 * 必须在 AssistantRuntimeProvider 内部使用。
 */
function ThreadUrlSync({ onThreadChange }: { onThreadChange?: (threadId: string) => void }) {
  // threadItems 为数组，需要根据 mainThreadId 查找对应项的 remoteId
  const remoteId = useAuiState((s) => {
    const item = s.threads.threadItems.find((i) => i.id === s.threads.mainThreadId);
    return item?.remoteId;
  });

  useEffect(() => {
    // 仅同步真实后端 ID，跳过本地临时 ID
    if (remoteId && !remoteId.startsWith('__LOCALID_')) {
      onThreadChange?.(remoteId);
    }
  }, [remoteId, onThreadChange]);

  return null;
}

/**
 * Chat 左侧面板 — 基于 ThreadListSidebar 的视觉结构：
 * aside > header（Agent 选择器）+ content（ThreadList）。
 *
 * 使用 assistant-ui 的 ThreadList 组件管理对话列表，
 * 使用普通 aside 而非 shadcn Sidebar 以避免与 Layout 的 SidebarProvider 冲突。
 */
export function ChatSidebar({
  agents,
  selectedAgent,
  onSelectAgent,
  onThreadChange,
}: ChatSidebarProps) {
  const { t } = useTranslation('conversations');

  const handleAgentChange = useCallback(
    (value: string) => {
      const agent = agents.find((a) => a.id === value);
      if (agent) onSelectAgent(agent);
    },
    [agents, onSelectAgent],
  );

  return (
    <aside className="w-72 border-r bg-background flex flex-col shrink-0">
      {/* Header — Agent 选择器 */}
      <div className="p-3 space-y-2 border-b">
        <div className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg shrink-0">
            <Bot className="size-4" />
          </div>
          <Select value={selectedAgent?.id ?? ''} onValueChange={handleAgentChange}>
            <SelectTrigger className="h-8 flex-1">
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

        {/* 线程切换时同步 URL（仅在 AssistantRuntimeProvider 内可用） */}
        {onThreadChange && <ThreadUrlSync onThreadChange={onThreadChange} />}
      </div>

      {/* Content — 对话列表（ThreadList 需要 AuiProvider） */}
      <div className="flex-1 overflow-y-auto">
        {onThreadChange ? (
          <ThreadList />
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Select an agent to start chatting
          </div>
        )}
      </div>
    </aside>
  );
}
