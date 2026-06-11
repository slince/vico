// 1. React
import { Fragment, useCallback } from 'react';

// 2. Third-party
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
 * Displays the full message history for a single conversation identified by
 * the `:id` route param. Each message is rendered as a role-aware bubble with
 * optional tool-call disclosure.
 *
 * States handled:
 * - **loading**  – skeleton layout
 * - **not found** – Empty component with back button
 * - **data**      – message list inside a ScrollArea
 *
 * Navigation: a back button returns the user to `/conversations`.
 */
export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ---- query -------------------------------------------------------------

  /** Fetch the full conversation payload; only runs when `id` is available */
  const {
    data: conversation,
    isLoading,
  } = useQuery<ConversationDetail>({
    queryKey: ['conversation', id],
    queryFn: () => api(`/conversations/${id}`),
    enabled: !!id, // prevent the query from firing with an undefined id
  });

  // ---- navigation callback -----------------------------------------------

  /**
   * Navigates back to the conversations list. Uses `useCallback` to keep a
   * stable reference for the button `onClick` handler.
   */
  const handleBack = useCallback(() => {
    navigate('/conversations');
  }, [navigate]);

  // ---- loading state -----------------------------------------------------
  if (isLoading) {
    return <ConversationDetailSkeleton />;
  }

  // ---- not-found guard ---------------------------------------------------
  if (!conversation) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <MessageSquare size={24} />
        </EmptyMedia>
        <EmptyTitle>对话未找到</EmptyTitle>
        <EmptyDescription>该对话可能已被删除，或 ID 无效</EmptyDescription>
        <Button variant="outline" onClick={handleBack}>返回列表</Button>
      </Empty>
    );
  }

  // ---- derived values ----------------------------------------------------

  /** Message list – default to empty array if not present */
  const messages: Message[] = conversation.messages ?? [];

  // ---- render ------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header bar: back button + metadata */}
      <div className="flex items-center gap-4">
        {/* Back navigation button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="返回对话列表"
        >
          <ArrowLeft size={20} />
        </Button>

        <div>
          <h2 className="text-2xl font-bold tracking-tight">对话详情</h2>

          {/* Metadata line: agent name, model, message count */}
          <p className="text-sm text-muted-foreground">
            Agent: {conversation.agent_name ?? conversation.agent_id}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            模型: {conversation.model_name}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            {conversation.message_count} 条消息
          </p>
        </div>
      </div>

      {/* Message list – scrollable area with constrained width */}
      <ScrollArea className="h-[calc(100vh-200px)] rounded-lg border">
        <div className="max-w-3xl mx-auto space-y-4 p-6">
          {messages.length === 0 ? (
            /* Edge case: conversation exists but has zero messages */
            <div className="text-center py-16 text-muted-foreground text-sm">
              暂无消息
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
