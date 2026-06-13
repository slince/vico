// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Database, Trash2 } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

/** 文档块数据结构 */
interface Chunk {
  id: string;
  content: string;
  metadata: string | null;
}

/** 知识库详情数据结构 */
interface KnowledgeBaseDetail {
  id: string;
  name: string;
  description: string | null;
  source: string;
  chunk_count: number;
  chunks: Chunk[];
}

/**
 * 知识库详情页面
 * 展示知识库元信息及其包含的所有文档块列表
 */
export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('knowledge');

  const [deleteChunkId, setDeleteChunkId] = useState<string | null>(null);

  const { data: kb, isLoading } = useQuery<KnowledgeBaseDetail>({
    queryKey: ['knowledge-base', id],
    queryFn: () => api(`/knowledge-bases/${id}`),
    enabled: !!id,
  });

  const deleteChunkMutation = useMutation({
    mutationFn: (chunkId: string) =>
      api(`/knowledge-bases/${id}/chunks/${chunkId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id] });
      setDeleteChunkId(null);
    },
  });

  const handleBack = useCallback(() => {
    navigate('/knowledge');
  }, [navigate]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteChunkId) {
      deleteChunkMutation.mutate(deleteChunkId);
    }
  }, [deleteChunkId, deleteChunkMutation]);

  /** 安全解析文件名 */
  const parseFilename = useCallback(
    (metadata: string | null): string => {
      if (!metadata) return t('unknownFile');
      try {
        const parsed = JSON.parse(metadata);
        return parsed.filename || t('unknownFile');
      } catch {
        return t('unknownFile');
      }
    },
    [t],
  );

  // ---------- 加载态 ----------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Separator />
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <Skeleton className="h-3 w-32 mb-2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mt-1" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 空/错误态 ----------
  if (!kb) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Database size={24} />
        </EmptyMedia>
        <EmptyTitle>{t('kbNotFound')}</EmptyTitle>
        <EmptyDescription>{t('kbNotFoundDesc')}</EmptyDescription>
        <Button variant="outline" onClick={handleBack}>{t('common:backToList')}</Button>
      </Empty>
    );
  }

  const chunks = kb.chunks || [];

  // ---------- 渲染 ----------
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight truncate">{kb.name}</h2>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            {kb.description && (
              <>
                <span>{kb.description}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{t('chunkCount', { count: kb.chunk_count })}</span>
            <span aria-hidden="true">·</span>
            <Badge variant="secondary" className="text-xs">
              {kb.source === 'skill_resource' ? t('sourceSkill') : t('sourceUpload')}
            </Badge>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-medium mb-3">{t('chunkListTitle')}</h3>

        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t('noChunks')}
          </p>
        ) : (
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="space-y-3 pr-4">
              {chunks.map((chunk) => (
                <Card key={chunk.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                          {parseFilename(chunk.metadata)}
                        </p>
                        <p className="text-sm line-clamp-3 text-foreground/80">
                          {chunk.content}
                        </p>
                      </div>
                      <AlertDialog
                        open={deleteChunkId === chunk.id}
                        onOpenChange={(open) => {
                          if (!open) setDeleteChunkId(null);
                        }}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => setDeleteChunkId(chunk.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('deleteChunkTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('deleteChunkDesc')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setDeleteChunkId(null)}
                            >
                              {t('common:cancel')}
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={handleDeleteConfirm}
                              disabled={deleteChunkMutation.isPending}
                            >
                              {deleteChunkMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                            </Button>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
