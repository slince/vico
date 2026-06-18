// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';

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
import {
  AlertDialog, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';
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
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
}

/**
 * Chat 左侧面板 — Agent 选择器、新建对话按钮、对话列表。
 */
export function ChatSidebar({
  agents,
  selectedAgentId,
  onSelectAgent,
  activeThreadId,
  onSelectThread,
  onNewChat,
}: ChatSidebarProps) {
  const { t } = useTranslation('conversations');
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ConversationItem | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (activeThreadId === id) {
        onNewChat();
      }
      setDeleteTarget(null);
    },
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

        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
          disabled={!selectedAgentId}
        >
          <Plus size={16} />
          {t('newChat')}
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
            {t('noConversations')}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {convs.map((conv) => (
              <div key={conv.id} className="group relative">
                <button
                  onClick={() => onSelectThread(conv.id)}
                  className={cn(
                    'w-full text-left p-2.5 rounded-md transition-colors',
                    activeThreadId === conv.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <div className="text-sm font-medium truncate">
                    {conv.agent_name || conv.agent_id.slice(0, 8)}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t('messageCount', { count: conv.message_count })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(conv.updated_at)}
                    </span>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(conv);
                  }}
                  className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('deleteCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {t('deleteConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
