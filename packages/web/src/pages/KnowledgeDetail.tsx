// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Database, FilePlus, FolderPlus, LayoutGrid, LayoutList } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
// 5. 页面子组件
import { ChunkDrawer } from './knowledge-detail/ChunkDrawer';
import { CreateDocumentDialog } from './knowledge-detail/CreateDocumentDialog';
import { CreateFolderDialog } from './knowledge-detail/CreateFolderDialog';
import { DocumentTable, DocumentTableSkeleton, DocumentTableEmpty } from './knowledge-detail/DocumentTable';
import { DocumentGrid, DocumentGridSkeleton, DocumentGridEmpty } from './knowledge-detail/DocumentGrid';

// 6. 类型
import type { DocumentItem, KnowledgeBaseDetail, PaginatedDocuments } from './knowledge-detail/types';

/**
 * 知识库详情页面
 * 负责数据获取、mutation 和子组件编排；文件分块通过右侧抽屉查看。
 */
export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('knowledge');

  // ---------- 状态 ----------
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [docPage, setDocPage] = useState(1);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDocName, setSelectedDocName] = useState<string>('');

  // ---------- 数据获取 ----------

  /** 知识库详情 */
  const { data: kb, isLoading: kbLoading } = useQuery<KnowledgeBaseDetail>({
    queryKey: ['knowledge-base', id],
    queryFn: () => api(`/knowledge-bases/${id}`),
    enabled: !!id,
  });

  /** 文档列表（分页） */
  const { data: docPageData, isLoading: docsLoading } = useQuery<PaginatedDocuments>({
    queryKey: ['knowledge-base', id, 'documents', docPage],
    queryFn: () => api(`/knowledge-bases/${id}/documents?page=${docPage}&page_size=20`),
    enabled: !!id,
  });
  const documents = docPageData?.data ?? [];
  const docTotal = docPageData?.total ?? 0;

  // ---------- 操作 ----------

  const deleteDocMutation = useMutation({
    mutationFn: (docId: string) =>
      api(`/knowledge-bases/${id}/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id, 'documents'] });
      setDeleteDocId(null);
    },
  });

  const createDocMutation = useMutation({
    mutationFn: (data: { content: string; filename: string }) =>
      api(`/knowledge-bases/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => setNewDocOpen(false),
  });

  const createFolderMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      api(`/knowledge-bases/${id}/folders`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id, 'documents'] });
      setNewFolderOpen(false);
    },
  });

  // ---------- 事件处理 ----------

  const handleBack = useCallback(() => {
    navigate('/knowledge');
  }, [navigate]);

  const handleDeleteDocConfirm = useCallback(() => {
    if (deleteDocId) deleteDocMutation.mutate(deleteDocId);
  }, [deleteDocId, deleteDocMutation]);

  const handleSelectDoc = useCallback((doc: DocumentItem) => {
    if (doc.status !== 'ready') return;
    if (selectedDocId === doc.id) {
      setSelectedDocId(null);
      setSelectedDocName('');
    } else {
      setSelectedDocId(doc.id);
      setSelectedDocName(doc.filename);
    }
  }, [selectedDocId]);

  const handleChunkDrawerClose = useCallback((open: boolean) => {
    if (!open) { setSelectedDocId(null); setSelectedDocName(''); }
  }, []);

  // ==================== 加载态 ====================
  if (kbLoading) {
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
        <Skeleton className="h-8 w-64" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ==================== 空/错误态 ====================
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

  // ==================== 渲染 ====================
  return (
    <div className="space-y-6">
      {/* 头部 */}
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
            <span aria-hidden="true">·</span>
            <Button variant="outline" size="sm" onClick={() => setOverviewOpen(true)} className="shrink-0">
              <Database className="size-4" />
              <span className="ml-1.5">{t('tabOverview')}</span>
            </Button>
          </div>
        </div>

      </div>

      <Separator />

      {/* 概览弹窗 */}
      <Dialog open={overviewOpen} onOpenChange={setOverviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tabOverview')}</DialogTitle>
            <DialogDescription>{kb.description || t('noDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('name')}:</span>
              <span className="font-medium">{kb.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('chunkCount', { count: kb.chunk_count })}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('tabDocuments')}:</span>
              <span className="font-medium">{documents.length}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('colStatus')}:</span>
              <Badge variant="secondary" className="text-xs">
                {kb.source === 'skill_resource' ? t('sourceSkill') : t('sourceUpload')}
              </Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 文档管理 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{t('tabDocuments')}</h3>
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon-xs"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setViewMode('list')}
            >
              <LayoutList className="size-3.5" />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon-xs"
              className="h-8 w-8 rounded-l-none"
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="size-3.5" />
            </Button>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <FilePlus className="size-4" />
              <span className="ml-1.5">{t('common:create')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setNewDocOpen(true)}>
              <FilePlus className="size-4" />
              {t('newDocumentTrigger')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="size-4" />
              {t('newFolderTrigger')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CreateDocumentDialog
        open={newDocOpen}
        onOpenChange={setNewDocOpen}
        onSubmit={(data) => createDocMutation.mutate(data)}
        isPending={createDocMutation.isPending}
      />
      <CreateFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        onSubmit={(data) => createFolderMutation.mutate(data)}
        isPending={createFolderMutation.isPending}
      />
      {docsLoading ? (
        viewMode === 'list' ? <DocumentTableSkeleton /> : <DocumentGridSkeleton />
      ) : documents.length === 0 ? (
        viewMode === 'list' ? <DocumentTableEmpty t={t} /> : <DocumentGridEmpty t={t} />
      ) : viewMode === 'list' ? (
        <DocumentTable
          documents={documents}
          selectedDocId={selectedDocId}
          deleteDocId={deleteDocId}
          onSelectDoc={handleSelectDoc}
          onDeleteDocIdChange={setDeleteDocId}
          onDeleteConfirm={handleDeleteDocConfirm}
          deletePending={deleteDocMutation.isPending}
          t={t}
        />
      ) : (
        <DocumentGrid
          documents={documents}
          selectedDocId={selectedDocId}
          deleteDocId={deleteDocId}
          onSelectDoc={handleSelectDoc}
          onDeleteDocIdChange={setDeleteDocId}
          onDeleteConfirm={handleDeleteDocConfirm}
          deletePending={deleteDocMutation.isPending}
          t={t}
        />
      )}
      {docTotal > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t('chunkCount', { count: docTotal }).replace(/分块/, '文档')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              disabled={docPage <= 1}
              onClick={() => setDocPage((p) => Math.max(1, p - 1))}
            >
              {t('prevPage')}
            </Button>
            <span className="text-sm">{docPage}</span>
            <Button
              variant="outline" size="sm"
              disabled={documents.length < 20}
              onClick={() => setDocPage((p) => p + 1)}
            >
              {t('nextPage')}
            </Button>
          </div>
        </div>
      )}

      {/* 选中文档的分块抽屉 */}
      <ChunkDrawer
        kbId={id!}
        documentId={selectedDocId}
        documentName={selectedDocName}
        open={!!selectedDocId}
        onOpenChange={handleChunkDrawerClose}
        t={t}
      />
    </div>
  );
}
