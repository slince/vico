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
import {
  Dialog, DialogTrigger, DialogContent,
  DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';

// ---------- 类型 ----------

/** 文档块数据结构 */
interface ChunkItem {
  id: string;
  content: string;
  metadata: string;
}

/** 知识库中的文档 */
interface DocumentItem {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: string;
  source: string;
  created_at: number;
}

/** 知识库详情数据结构 */
interface KnowledgeBaseDetail {
  id: string;
  name: string;
  description: string | null;
  source: string;
  chunk_count: number;
}

/** 分页文档列表 */
interface PaginatedDocuments {
  data: DocumentItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 分页分块列表 */
interface PaginatedChunks {
  data: ChunkItem[];
  total: number;
  page: number;
  page_size: number;
}

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

/** 表格列头的中英文本地化标签（这些 key 尚未加入 i18n） */
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
 * 通过 Tab 切换查看知识库概览、文档列表和分块列表
 */
export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('knowledge');
  const colLabels = useColumnLabels();

  // ---------- 状态 ----------
  const [deleteChunkId, setDeleteChunkId] = useState<string | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [newDocContent, setNewDocContent] = useState('');
  const [docPage, setDocPage] = useState(1);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDocName, setSelectedDocName] = useState<string>('');
  const [chunkPage, setChunkPage] = useState(1);

  // ---------- 数据获取 ----------

  /** 知识库详情 */
  const { data: kb, isLoading: kbLoading } = useQuery<KnowledgeBaseDetail>({
    queryKey: ['knowledge-base', id],
    queryFn: () => api(`/knowledge-bases/${id}`),
    enabled: !!id,
  });

  /** 选中文档的分块（分页） */
  const { data: chunkPageData, isLoading: chunksLoading } = useQuery<PaginatedChunks>({
    queryKey: ['knowledge-base', id, 'chunks', selectedDocId, chunkPage],
    queryFn: () => api(`/knowledge-bases/${id}/chunks?document_id=${selectedDocId}&page=${chunkPage}&page_size=20`),
    enabled: !!id && !!selectedDocId,
  });
  const chunks = chunkPageData?.data ?? [];
  const chunkTotal = chunkPageData?.total ?? 0;
  const chunkPageSize = chunkPageData?.page_size ?? 20;

  /** 文档列表（分页） */
  const { data: docPageData, isLoading: docsLoading } = useQuery<PaginatedDocuments>({
    queryKey: ['knowledge-base', id, 'documents', docPage],
    queryFn: () => api(`/knowledge-bases/${id}/documents?page=${docPage}&page_size=20`),
    enabled: !!id,
  });
  const documents = docPageData?.data ?? [];
  const docTotal = docPageData?.total ?? 0;

  // ---------- 操作 ----------

  /** 删除分块 */
  const deleteChunkMutation = useMutation({
    mutationFn: (chunkId: string) =>
      api(`/knowledge-bases/${id}/chunks/${chunkId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id, 'chunks', selectedDocId] });
      setDeleteChunkId(null);
    },
  });

  /** 删除文档 */
  const deleteDocMutation = useMutation({
    mutationFn: (docId: string) =>
      api(`/knowledge-bases/${id}/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id, 'documents'] });
      setDeleteDocId(null);
    },
  });

  /** 手动创建文档 */
  const createDocMutation = useMutation({
    mutationFn: (data: { content: string; filename: string }) =>
      api(`/knowledge-bases/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id, 'documents'] });
      setNewDocOpen(false);
      setNewDocName('');
      setNewDocContent('');
    },
  });

  // ---------- 事件处理 ----------

  const handleBack = useCallback(() => {
    navigate('/knowledge');
  }, [navigate]);

  const handleDeleteChunkConfirm = useCallback(() => {
    if (deleteChunkId) {
      deleteChunkMutation.mutate(deleteChunkId);
    }
  }, [deleteChunkId, deleteChunkMutation]);

  const handleDeleteDocConfirm = useCallback(() => {
    if (deleteDocId) {
      deleteDocMutation.mutate(deleteDocId);
    }
  }, [deleteDocId, deleteDocMutation]);

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
      {/* 头部：返回按钮 + 名称 + 描述 */}
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

      {/* Tab 视图 */}
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
            <Dialog open={newDocOpen} onOpenChange={setNewDocOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <FilePlus className="size-4" />
                  <span className="ml-1.5">{t('newDocument')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('newDocumentTitle')}</DialogTitle>
                  <DialogDescription>{t('newDocumentDesc')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('documentName')}</label>
                    <Input
                      placeholder={t('documentNamePlaceholder')}
                      value={newDocName}
                      onChange={(e) => setNewDocName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('documentContent')}</label>
                    <Textarea
                      className="min-h-[200px]"
                      placeholder={t('documentContentPlaceholder')}
                      value={newDocContent}
                      onChange={(e) => setNewDocContent(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNewDocOpen(false)}>
                    {t('common:cancel')}
                  </Button>
                  <Button
                    onClick={() => createDocMutation.mutate({ content: newDocContent, filename: newDocName })}
                    disabled={!newDocName.trim() || !newDocContent.trim() || createDocMutation.isPending}
                  >
                    {createDocMutation.isPending ? t('common:creating') : t('createAndIndex')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
                      onClick={() => {
                        if (doc.status !== 'ready') return;
                        if (isSelected) {
                          setSelectedDocId(null);
                          setSelectedDocName('');
                        } else {
                          setSelectedDocId(doc.id);
                          setSelectedDocName(doc.filename);
                          setChunkPage(1);
                        }
                      }}
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
                          onOpenChange={(open) => {
                            if (!open) setDeleteDocId(null);
                          }}
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
                              <Button
                                variant="outline"
                                onClick={() => setDeleteDocId(null)}
                              >
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
                  variant="outline"
                  size="sm"
                  disabled={docPage <= 1}
                  onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                >
                  {i18n.language.startsWith('zh') ? '上一页' : 'Prev'}
                </Button>
                <span className="text-sm">{docPage}</span>
                <Button
                  variant="outline"
                  size="sm"
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
      <Sheet open={!!selectedDocId} onOpenChange={(open) => { if (!open) { setSelectedDocId(null); setSelectedDocName(''); } }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col">
          <SheetHeader>
            <SheetTitle className="truncate pr-8">{selectedDocName || t('chunkListTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-auto mt-6 -mr-6 pr-6">
            {chunksLoading ? (
              <div className="space-y-3">
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
            ) : chunks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('noChunks')}
              </p>
            ) : (
              <div className="space-y-3">
                {chunks.map((chunk) => (
                  <Card key={chunk.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                            {parseFilename(chunk.metadata)}
                          </p>
                          <p className="text-sm text-foreground/80 whitespace-pre-wrap">
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
                              onClick={(e) => { e.stopPropagation(); setDeleteChunkId(chunk.id); }}
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
                                onClick={handleDeleteChunkConfirm}
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
            )}
          </div>

          {/* 分块分页 */}
          {chunkTotal > chunkPageSize && (
            <div className="flex items-center justify-between pt-4 border-t shrink-0">
              <span className="text-xs text-muted-foreground">
                {t('chunkCount', { count: chunkTotal }).replace(/分块/, '条')}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={chunkPage <= 1}
                  onClick={() => setChunkPage((p) => Math.max(1, p - 1))}
                >
                  {i18n.language.startsWith('zh') ? '上一页' : 'Prev'}
                </Button>
                <span className="text-xs px-1">{chunkPage}/{Math.ceil(chunkTotal / chunkPageSize)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={chunks.length < chunkPageSize}
                  onClick={() => setChunkPage((p) => p + 1)}
                >
                  {i18n.language.startsWith('zh') ? '下一页' : 'Next'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
