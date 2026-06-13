// 1. React
import { Fragment, useCallback } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';

// 3. API / Utils
import { api } from '@/api/client';

// 4. UI components
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

// 5. Sub-components
import { MessageBubble } from './conversation-detail/MessageBubble';
import { ConversationDetailSkeleton } from './conversation-detail/ConversationDetailSkeleton';

// 6. Types
import type { Message, ConversationDetail } from './conversation-detail/types';

/**
 * Conversation detail page.
 *
 * Displays the full message history for a single conversation.
 */
export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('conversations');

  const {
    data: conversation,
    isLoading,
  } = useQuery<ConversationDetail>({
    queryKey: ['conversation', id],
    queryFn: () => api(`/conversations/${id}`),
    enabled: !!id,
  });

  const handleBack = useCallback(() => {
    navigate('/conversations');
  }, [navigate]);

  if (isLoading) {
    return <ConversationDetailSkeleton />;
  }

  if (!conversation) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <MessageSquare size={24} />
        </EmptyMedia>
        <EmptyTitle>{t('conversationNotFound')}</EmptyTitle>
        <EmptyDescription>{t('conversationNotFoundDesc')}</EmptyDescription>
        <Button variant="outline" onClick={handleBack}>{t('backToList')}</Button>
      </Empty>
    );
  }

  const messages: Message[] = conversation.messages ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label={t('backToConversations')}
        >
          <ArrowLeft size={20} />
        </Button>

        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('detailTitle')}</h2>

          <p className="text-sm text-muted-foreground">
            {t('metadataAgent')}: {conversation.agent_name ?? conversation.agent_id}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            {t('metadataModel')}: {conversation.model_name}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            {t('totalRecords', { count: conversation.message_count })}
          </p>
        </div>
      </div>

      <ScrollArea className="h-[calc(100vh-200px)] rounded-lg border">
        <div className="max-w-3xl mx-auto space-y-4 p-6">
          {messages.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {t('noMessages')}
            </div>
          ) : (
            messages.map((msg) => (
              <Fragment key={msg.id}>
                <MessageBubble message={msg} />
              </Fragment>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
