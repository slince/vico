// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Database, FilePlus, FileText, Trash2 } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
// 5. 页面子组件
import { ChunkDrawer } from './knowledge-detail/ChunkDrawer';
import { CreateDocumentDialog } from './knowledge-detail/CreateDocumentDialog';

// 6. 类型
import type {
  DocumentItem, KnowledgeBaseDetail, PaginatedDocuments,
} from './knowledge-detail/types';

// ---------- 工具函数 ----------

/** 将字节数转换为可读的文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 根据文档状态返回 Badge 的 variant 和样式类名 */
function getStatusBadgeProps(status: string): { variant: 'destructive' | 'secondary'; className: string } {
  switch (status) {
    case 'ready':
      return { variant: 'secondary', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    case 'indexing':
    case 'parsing':
      return { variant: 'secondary', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'error':
      return { variant: 'destructive', className: '' };
    case 'pending':
    default:
      return { variant: 'secondary', className: '' };
  }
}

/** 文档状态的中英文本地化标签 */
function getStatusLabel(status: string, lang: string): string {
  const isZh = lang.startsWith('zh');
  switch (status) {
    case 'ready': return isZh ? '就绪' : 'Ready';
    case 'indexing': return isZh ? '索引中' : 'Indexing';
    case 'parsing': return isZh ? '解析中' : 'Parsing';
    case 'error': return isZh ? '错误' : 'Error';
    case 'pending': return isZh ? '等待中' : 'Pending';
    default: return status;
  }
}

/** 表格列头的中英文本地化标签 */
function useColumnLabels() {
  const { i18n } = useTranslation('knowledge');
  const isZh = i18n.language.startsWith('zh');
  return {
    type: isZh ? '类型' : 'Type',
    size: isZh ? '大小' : 'Size',
    status: isZh ? '状态' : 'Status',
    chunks: isZh ? '分块数' : 'Chunks',
    actions: isZh ? '操作' : 'Actions',
  } as const;
}

/**
 * 知识库详情页面
 * 负责数据获取、mutation 和子组件编排；文件分块通过右侧抽屉查看。
 */
export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('knowledge');
  const colLabels = useColumnLabels();

  // ---------- 状态 ----------
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [docPage, setDocPage] = useState(1);
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
          </div>
        </div>
      </div>

      <Separator />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabOverview')}</TabsTrigger>
          <TabsTrigger value="documents">{t('tabDocuments')}</TabsTrigger>
        </TabsList>

        {/* ---- 概览 Tab ---- */}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('tabOverview')}</CardTitle>
              <CardDescription>{kb.description || t('noDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                <span className="text-muted-foreground">{colLabels.status}:</span>
                <Badge variant="secondary" className="text-xs">
                  {kb.source === 'skill_resource' ? t('sourceSkill') : t('sourceUpload')}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- 文档 Tab ---- */}
        <TabsContent value="documents" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">{t('tabDocuments')}</h3>
            <CreateDocumentDialog
              open={newDocOpen}
              onOpenChange={setNewDocOpen}
              onSubmit={(data) => createDocMutation.mutate(data)}
              isPending={createDocMutation.isPending}
              trigger={(
                <Button size="sm">
                  <FilePlus className="size-4" />
                  <span className="ml-1.5">{t('newDocument')}</span>
                </Button>
              )}
            />
          </div>
          {docsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <FileText size={24} />
              </EmptyMedia>
              <EmptyTitle>{t('noDocuments')}</EmptyTitle>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{colLabels.type}</TableHead>
                  <TableHead>{colLabels.size}</TableHead>
                  <TableHead>{colLabels.status}</TableHead>
                  <TableHead>{colLabels.chunks}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => {
                  const badgeProps = getStatusBadgeProps(doc.status);
                  const isSelected = selectedDocId === doc.id;
                  return (
                    <TableRow
                      key={doc.id}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-accent' : 'hover:bg-muted/50'}`}
                      onClick={() => handleSelectDoc(doc)}
                    >
                      <TableCell className="font-medium max-w-48 truncate">
                        {doc.filename}
                      </TableCell>
                      <TableCell className="text-muted-foreground uppercase text-xs">
                        {doc.file_type || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatFileSize(doc.file_size)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeProps.variant} className={badgeProps.className}>
                          {getStatusLabel(doc.status, i18n.language)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {doc.chunk_count}
                      </TableCell>
                      <TableCell>
                        <AlertDialog
                          open={deleteDocId === doc.id}
                          onOpenChange={(open) => { if (!open) setDeleteDocId(null); }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteDocId(doc.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('deleteDocument')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('confirmDeleteDoc', { name: doc.filename })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <Button variant="outline" onClick={() => setDeleteDocId(null)}>
                                {t('common:cancel')}
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={handleDeleteDocConfirm}
                                disabled={deleteDocMutation.isPending}
                              >
                                {deleteDocMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {docTotal > 20 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                {t('chunkCount', { count: docTotal }).replace(/分块/, '文档')}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={docPage <= 1}
                  onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                >
                  {i18n.language.startsWith('zh') ? '上一页' : 'Prev'}
                </Button>
                <span className="text-sm">{docPage}</span>
                <Button
                  variant="outline" size="sm"
                  disabled={documents.length < 20}
                  onClick={() => setDocPage((p) => p + 1)}
                >
                  {i18n.language.startsWith('zh') ? '下一页' : 'Next'}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 选中文档的分块抽屉 */}
      <ChunkDrawer
        kbId={id!}
        documentId={selectedDocId}
        documentName={selectedDocName}
        open={!!selectedDocId}
        onOpenChange={handleChunkDrawerClose}
        t={t}
        language={i18n.language}
      />
    </div>
  );
}
