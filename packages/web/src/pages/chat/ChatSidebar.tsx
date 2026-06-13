// 1. React
import { useCallback } from 'react';

// 2. Third-party
import { useQuery } from '@tanstack/react-query';
import { Plus, MessageSquare } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/date-format';

interface Agent {
  id: string;
  name: string;
}

interface ConversationItem {
  id: string;
  agent_id: string;
  agent_name?: string;
  message_count: number;
  updated_at: string;
}

interface ChatSidebarProps {
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  activeConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
}

/**
 * Chat 左侧面板 — Agent 选择器、新建对话按钮、对话列表。
 */
export function ChatSidebar({
  agents,
  selectedAgentId,
  onSelectAgent,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ChatSidebarProps) {
  // 获取对话列表
  const { data: conversations, isLoading: convsLoading } = useQuery<ConversationItem[]>({
    queryKey: ['conversations', selectedAgentId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedAgentId) params.set('agent_id', selectedAgentId);
      return api(`/conversations?${params.toString()}`);
    },
    enabled: !!selectedAgentId,
  });

  const convs: ConversationItem[] = conversations ?? [];

  const handleAgentChange = useCallback(
    (value: string) => {
      onSelectAgent(value);
    },
    [onSelectAgent]
  );

  return (
    <aside className="w-72 border-r bg-background flex flex-col">
      {/* Agent 选择器 + 新建按钮 */}
      <div className="p-3 space-y-2 border-b">
        <Select value={selectedAgentId || ''} onValueChange={handleAgentChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择 Agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
          disabled={!selectedAgentId}
        >
          <Plus size={16} />
          新建对话
        </Button>
      </div>

      {/* 对话列表 */}
      <ScrollArea className="flex-1">
        {convsLoading ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : convs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            暂无对话
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {convs.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={cn(
                  'w-full text-left p-3 rounded-md transition-colors',
                  activeConversationId === conv.id
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                )}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {conv.agent_name || conv.agent_id.slice(0, 8)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">
                    {conv.message_count} 条消息
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(conv.updated_at)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
