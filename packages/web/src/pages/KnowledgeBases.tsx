// 1. React
import { useCallback, useRef, useState } from 'react';

// 2. Third-party
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Database, Plus, Trash2, Upload } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

/** 知识库条目数据结构 */
interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  source: 'skill_resource' | 'manual';
  chunk_count: number;
}

/** 可用于上传的文件类型扩展名列表 */
const ACCEPTED_FILE_TYPES = '.pdf,.txt,.md,.csv';

/**
 * 知识库列表页面
 * 使用卡片网格展示所有知识库，支持创建、删除和上传文档操作
 */
export default function KnowledgeBases() {
  const queryClient = useQueryClient();

  // ---------- 对话框状态 ----------
  /** 控制创建知识库对话框的开关 */
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  /** 创建表单 - 知识库名称 */
  const [name, setName] = useState('');
  /** 创建表单 - 知识库描述 */
  const [desc, setDesc] = useState('');
  /** 待删除的知识库 ID（为空表示未确认删除） */
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // ---------- 文件上传 ----------
  /** 用于触发文件选择的隐藏 input 引用 */
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 当前要上传到的知识库 ID */
  const [uploadTargetKbId, setUploadTargetKbId] = useState<string | null>(null);

  // ---------- 数据获取 ----------
  const { data: kbs, isLoading } = useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: () => api('/knowledge-bases'),
  });

  // ---------- 变更操作 ----------

  /**
   * 创建知识库变更
   * 成功后刷新列表并关闭对话框、清空表单
   */
  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      api('/knowledge-bases', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      // 刷新知识库列表
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      // 重置 UI 状态
      setCreateDialogOpen(false);
      setName('');
      setDesc('');
    },
  });

  /**
   * 删除知识库变更
   * 成功后刷新列表并清空待删除目标
   */
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/knowledge-bases/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setDeleteTargetId(null);
    },
  });

  /**
   * 上传文档变更
   * 使用 FormData 直接通过 fetch 发送，因为 api() 客户端默认 Content-Type 为 JSON
   */
  const uploadMutation = useMutation({
    mutationFn: async ({ kbId, file }: { kbId: string; file: File }) => {
      const formData = new FormData();
      // 将文件添加到表单数据
      formData.append('file', file);
      const res = await fetch(`/api/v1/knowledge-bases/${kbId}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });

  // ---------- 事件处理 ----------

  /**
   * 打开文件选择器以上传文档
   * 程序化触发隐藏的 file input
   * @param kbId - 目标知识库的 ID
   */
  const handleUploadClick = useCallback((kbId: string) => {
    setUploadTargetKbId(kbId);
    // 通过 ref 安全地触发原生文件选择器
    fileInputRef.current?.click();
  }, []);

  /**
   * 处理用户选择的文件并触发上传
   * @param e - 文件 input 的 change 事件
   */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && uploadTargetKbId) {
        uploadMutation.mutate({ kbId: uploadTargetKbId, file });
      }
      // 重置 input 值，允许重复选择同一文件
      e.target.value = '';
      setUploadTargetKbId(null);
    },
    [uploadMutation, uploadTargetKbId],
  );

  /**
   * 提交创建知识库表单
   */
  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), description: desc.trim() });
  }, [name, desc, createMutation]);

  /**
   * 确认删除知识库
   */
  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
    }
  }, [deleteTargetId, deleteMutation]);

  // ---------- 派生数据 ----------
  const kbList = kbs || [];

  // ---------- 加载态 ----------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-1/3 mt-2" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-24" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 渲染 ----------
  return (
    <div className="space-y-6">
      {/* 页面标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">知识库</h2>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              新建知识库
            </Button>
          </DialogTrigger>
          {/* 创建知识库对话框 */}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建知识库</DialogTitle>
              <DialogDescription>
                创建一个新的知识库来存储和管理文档
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kb-name">名称</Label>
                <Input
                  id="kb-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入知识库名称"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kb-desc">描述（可选）</Label>
                <Textarea
                  id="kb-desc"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="输入知识库描述"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button onClick={handleCreate} disabled={!name.trim() || createMutation.isPending}>
                {createMutation.isPending ? '创建中...' : '创建'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 隐藏的文件选择器，程序化触发 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 空状态 */}
      {kbList.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <Database className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>暂无知识库</EmptyTitle>
            <EmptyDescription>
              点击上方按钮创建第一个知识库，或从 Skill 中自动导入
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        /* 知识库卡片网格 */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kbList.map((kb) => (
            <Card key={kb.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">
                    <Link
                      to={`/knowledge/${kb.id}`}
                      className="hover:text-primary transition-colors"
                    >
                      {kb.name}
                    </Link>
                  </CardTitle>
                  {/* 来源类型标识 */}
                  <Badge variant={kb.source === 'skill_resource' ? 'secondary' : 'outline'}>
                    {kb.source === 'skill_resource' ? 'Skill内置' : '手动上传'}
                  </Badge>
                </div>
                <CardDescription>{kb.description || '无描述'}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {kb.chunk_count} 个文档块
                </p>
              </CardContent>
              <CardFooter className="border-t gap-2">
                {/* 上传文档按钮 */}
                <Button
                  size="sm"
                  onClick={() => handleUploadClick(kb.id)}
                  disabled={uploadMutation.isPending && uploadTargetKbId === kb.id}
                >
                  <Upload className="size-3.5" />
                  上传文档
                </Button>
                {/* 删除按钮 --- 使用 AlertDialog 确认 */}
                <AlertDialog
                  open={deleteTargetId === kb.id}
                  onOpenChange={(open) => {
                    if (!open) setDeleteTargetId(null);
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteTargetId(kb.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除</AlertDialogTitle>
                      <AlertDialogDescription>
                        确定要删除知识库「{kb.name}」吗？此操作不可撤销，所有文档块将被永久移除。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteTargetId(null)}
                      >
                        取消
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleDeleteConfirm}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? '删除中...' : '确认删除'}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
