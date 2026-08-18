// 1. React

// 2. Third-party
import {useTranslation} from 'react-i18next';
import {MessageCircle} from 'lucide-react';

// 3. UI components
import {Empty, EmptyDescription, EmptyMedia, EmptyTitle} from '@/components/ui/empty';
import {Button} from '@/components/ui/button';

interface AgentChatEmptyProps {
  hasAgents: boolean;
  onSelectFirstAgent: () => void;
}

/**
 * Agent 对话空态 — 未选中 Agent 时显示。
 */
export function ChatEmpty({ hasAgents, onSelectFirstAgent }: AgentChatEmptyProps) {
  const { t } = useTranslation("threads");
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <Empty>
        <EmptyMedia variant="icon">
          <MessageCircle size={32} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>{t("chatEmptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("chatEmptyDescription")}</EmptyDescription>
        {hasAgents && (
          <Button variant="outline" onClick={onSelectFirstAgent}>
            {t("chatEmptyButton")}
          </Button>
        )}
      </Empty>
    </div>
  );
}
