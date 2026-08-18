// 1. React
import { Fragment, useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Trash2 } from 'lucide-react';

// 3. API / Utils
import { api } from '@/api/client';

// 4. UI components
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. Sub-components
import { MessageBubble } from './thread-detail/MessageBubble';
import { ThreadDetailSkeleton } from './thread-detail/ThreadDetailSkeleton';

// 6. Types
import type { Message, ThreadDetail as ThreadDetailType } from './thread-detail/types';

/**
 * Thread detail page.
 *
 * Displays the full message history for a single thread.
 */
export default function ThreadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('threads');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    data: thread,
    isLoading,
  } = useQuery<ThreadDetailType>({
    queryKey: ['thread', id],
    queryFn: () => api(`/threads/${id}`),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/threads/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      navigate('/threads');
    },
  });

  const handleBack = useCallback(() => {
    navigate('/threads');
  }, [navigate]);

  if (isLoading) {
    return <ThreadDetailSkeleton />;
  }

  if (!thread) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <MessageSquare size={24} />
        </EmptyMedia>
        <EmptyTitle>{t('threadNotFound')}</EmptyTitle>
        <EmptyDescription>{t('threadNotFoundDesc')}</EmptyDescription>
        <Button variant="outline" onClick={handleBack}>{t('backToList')}</Button>
      </Empty>
    );
  }

  const messages: Message[] = thread.messages ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label={t('backToThreads')}
        >
          <ArrowLeft size={20} />
        </Button>

        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">{t('detailTitle')}</h2>

          <div className="text-sm text-muted-foreground">
            {t('metadataAgent')}: {thread.agentId}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            {t('totalRecords', { count: thread.messageCount })}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 size={14} className="mr-1.5" />
          {t('deleteButton')}
        </Button>
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('deleteCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {t('deleteConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
