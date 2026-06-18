// 1. React

// 2. Third-party
import { MessageCircle } from 'lucide-react';

// 3. UI components
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';

interface AgentChatEmptyProps {
  hasAgents: boolean;
  onSelectFirstAgent: () => void;
}

/**
 * Agent 对话空态 — 未选中 Agent 时显示。
 */
export function AgentChatEmpty({ hasAgents, onSelectFirstAgent }: AgentChatEmptyProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <Empty>
        <EmptyMedia variant="icon">
          <MessageCircle size={32} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>开始对话</EmptyTitle>
        <EmptyDescription>选择一个 Agent 开始对话</EmptyDescription>
        {hasAgents && (
          <Button variant="outline" onClick={onSelectFirstAgent}>
            选择 Agent
          </Button>
        )}
      </Empty>
    </div>
  );
}
