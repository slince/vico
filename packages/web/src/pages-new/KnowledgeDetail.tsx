// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Database, Trash2 } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

/** 文档块数据结构 */
interface Chunk {
  id: string;
  content: string;
  /** JSON 字符串，包含 filename 等元信息 */
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
 * 从 chunk 的 metadata JSON 字符串中安全解析出文件名
 * @param metadata - JSON 格式的元数据字符串
 * @returns 解析出的文件名，解析失败则返回 "未知文件"
 */
function parseFilename(metadata: string | null): string {
  if (!metadata) return '未知文件';
  try {
    const parsed = JSON.parse(metadata);
    return parsed.filename || '未知文件';
  } catch {
    return '未知文件';
  }
}

/**
 * 知识库详情页面
 * 展示知识库元信息及其包含的所有文档块列表
 */
export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /** 待删除的文档块 ID（为空表示未确认删除） */
  const [deleteChunkId, setDeleteChunkId] = useState<string | null>(null);

  // ---------- 数据获取 ----------
  const { data: kb, isLoading } = useQuery<KnowledgeBaseDetail>({
    queryKey: ['knowledge-base', id],
    queryFn: () => api(`/knowledge-bases/${id}`),
    enabled: !!id, // 仅在 id 存在时发起请求
  });

  // ---------- 变更操作 ----------

  /**
   * 删除单个文档块变更
   * 成功后刷新详情数据
   */
  const deleteChunkMutation = useMutation({
    mutationFn: (chunkId: string) =>
      api(`/knowledge-bases/${id}/chunks/${chunkId}`, { method: 'DELETE' }),
    onSuccess: () => {
      // 刷新知识库详情（含 chunk 列表）
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id] });
      setDeleteChunkId(null);
    },
  });

  // ---------- 事件处理 ----------

  /**
   * 返回知识库列表页
   */
  const handleBack = useCallback(() => {
    navigate('/knowledge');
  }, [navigate]);

  /**
   * 确认删除指定的文档块
   */
  const handleDeleteConfirm = useCallback(() => {
    if (deleteChunkId) {
      deleteChunkMutation.mutate(deleteChunkId);
    }
  }, [deleteChunkId, deleteChunkMutation]);

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
        <EmptyTitle>知识库未找到</EmptyTitle>
        <EmptyDescription>该知识库可能已被删除，或 ID 无效</EmptyDescription>
        <Button variant="outline" onClick={handleBack}>返回列表</Button>
      </Empty>
    );
  }

  const chunks = kb.chunks || [];

  // ---------- 渲染 ----------
  return (
    <div className="space-y-6">
      {/* 顶部：返回按钮 + 知识库元信息 */}
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
            <span>{kb.chunk_count} 个文档块</span>
            <span aria-hidden="true">·</span>
            {/* 来源类型标识 */}
            <Badge variant="secondary" className="text-xs">
              {kb.source === 'skill_resource' ? 'Skill内置' : '手动上传'}
            </Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* 文档块列表 */}
      <div>
        <h3 className="font-medium mb-3">文档块列表</h3>

        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            暂无文档块，请返回知识库列表上传文档
          </p>
        ) : (
          /* 使用 ScrollArea 处理过长的列表 */
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="space-y-3 pr-4">
              {chunks.map((chunk) => (
                <Card key={chunk.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* 从 metadata 中解析文件名 */}
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                          {parseFilename(chunk.metadata)}
                        </p>
                        {/* 内容预览，最多显示 3 行 */}
                        <p className="text-sm line-clamp-3 text-foreground/80">
                          {chunk.content}
                        </p>
                      </div>
                      {/* 删除文档块按钮 --- 使用 AlertDialog 确认 */}
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
                            <AlertDialogTitle>删除文档块</AlertDialogTitle>
                            <AlertDialogDescription>
                              确定要删除此文档块吗？该操作不可撤销。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setDeleteChunkId(null)}
                            >
                              取消
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={handleDeleteConfirm}
                              disabled={deleteChunkMutation.isPending}
                            >
                              {deleteChunkMutation.isPending ? '删除中...' : '确认删除'}
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
