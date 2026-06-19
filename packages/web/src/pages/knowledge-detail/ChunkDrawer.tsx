// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Item, ItemGroup, ItemMedia, ItemContent, ItemDescription, ItemActions,
} from '@/components/ui/item';

import type { PaginatedChunks } from './types';
import { DeleteChunkDialog } from './DeleteChunkDialog';

interface ChunkDrawerProps {
  kbId: string;
  documentId: string | null;
  documentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/**
 * 文档分块抽屉 — 内部管理分块查询、分页和删除操作。
 */
export function ChunkDrawer({
  kbId, documentId, documentName,
  open, onOpenChange, t,
}: ChunkDrawerProps) {
  const queryClient = useQueryClient();
  const [chunkPage, setChunkPage] = useState(1);
  const [deleteChunkId, setDeleteChunkId] = useState<string | null>(null);

  /** 分块查询 */
  const { data: chunkPageData, isLoading: chunksLoading } = useQuery<PaginatedChunks>({
    queryKey: ['knowledge-base', kbId, 'chunks', documentId, chunkPage],
    queryFn: () => api(`/knowledge-bases/${kbId}/chunks?document_id=${documentId}&page=${chunkPage}&page_size=20`),
    enabled: !!kbId && !!documentId && open,
  });
  const chunks = chunkPageData?.data ?? [];
  const chunkTotal = chunkPageData?.total ?? 0;
  const chunkPageSize = chunkPageData?.page_size ?? 20;

  /** 重置分页：切换文档或打开时 */
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      // 关闭时由父级清理 selectedDoc，此处只透传
    } else {
      setChunkPage(1);
      setDeleteChunkId(null);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  /** 删除分块 */
  const deleteMutation = useMutation({
    mutationFn: (chunkId: string) =>
      api(`/knowledge-bases/${kbId}/chunks/${chunkId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', kbId, 'chunks', documentId] });
      setDeleteChunkId(null);
    },
  });

  const handleDeleteConfirm = useCallback(() => {
    if (deleteChunkId) deleteMutation.mutate(deleteChunkId);
  }, [deleteChunkId, deleteMutation]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="truncate pr-8">{documentName || t('chunkListTitle')}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-auto mt-6 -mr-6 pr-6">
          {chunksLoading ? (
            <ItemGroup>
              {Array.from({ length: 4 }).map((_, i) => (
                <Item key={i} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <Skeleton className="size-5 rounded" />
                  </ItemMedia>
                  <ItemContent>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          ) : chunks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t('noChunks')}
            </p>
          ) : (
            <ItemGroup>
              {chunks.map((chunk, idx) => (
                <Item key={chunk.id} variant="outline" size="sm" className="group">
                  <ItemMedia variant="icon">
                    <span className="text-xs font-mono tabular-nums text-muted-foreground w-5 text-center">
                      #{(chunkPage - 1) * chunkPageSize + idx + 1}
                    </span>
                  </ItemMedia>
                  <ItemContent>
                    <ItemDescription className="line-clamp-none whitespace-pre-wrap text-foreground/80 text-xs leading-relaxed">
                      {chunk.content}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <DeleteChunkDialog
                      open={deleteChunkId === chunk.id}
                      onOpenChange={(open) => { if (!open) setDeleteChunkId(null); }}
                      onConfirm={handleDeleteConfirm}
                      isPending={deleteMutation.isPending}
                      t={t}
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>

        {/* 分页 */}
        {chunkTotal > chunkPageSize && (
          <div className="flex items-center justify-between pt-4 border-t shrink-0">
            <span className="text-xs text-muted-foreground">
              {`${t('chunkCount', { count: chunkTotal })}`.replace(/分块/, '条')}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline" size="sm"
                disabled={chunkPage <= 1}
                onClick={() => setChunkPage((p) => Math.max(1, p - 1))}
              >
                {t('prevPage')}
              </Button>
              <span className="text-xs px-1">{chunkPage}/{Math.ceil(chunkTotal / chunkPageSize)}</span>
              <Button
                variant="outline" size="sm"
                disabled={chunks.length < chunkPageSize}
                onClick={() => setChunkPage((p) => p + 1)}
              >
                {t('nextPage')}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
