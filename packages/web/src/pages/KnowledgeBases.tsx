// 1. React
import { useCallback, useRef, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('knowledge');
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetKbId, setUploadTargetKbId] = useState<string | null>(null);

  const { data: kbs, isLoading } = useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: () => api('/knowledge-bases'),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      api('/knowledge-bases', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setCreateDialogOpen(false);
      setName('');
      setDesc('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/knowledge-bases/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setDeleteTargetId(null);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ kbId, file }: { kbId: string; file: File }) => {
      const formData = new FormData();
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

  const handleUploadClick = useCallback((kbId: string) => {
    setUploadTargetKbId(kbId);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && uploadTargetKbId) {
        uploadMutation.mutate({ kbId: uploadTargetKbId, file });
      }
      e.target.value = '';
      setUploadTargetKbId(null);
    },
    [uploadMutation, uploadTargetKbId],
  );

  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), description: desc.trim() });
  }, [name, desc, createMutation]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
    }
  }, [deleteTargetId, deleteMutation]);

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
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              {t('createButton')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('createDialogTitle')}</DialogTitle>
              <DialogDescription>
                {t('createDialogDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kb-name">{t('name')}</Label>
                <Input
                  id="kb-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kb-desc">{t('desc')}</Label>
                <Textarea
                  id="kb-desc"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={t('descPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button onClick={handleCreate} disabled={!name.trim() || createMutation.isPending}>
                {createMutation.isPending ? t('common:creating') : t('common:create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleFileChange}
      />

      {kbList.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <Database className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {t('emptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
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
                  <Badge variant={kb.source === 'skill_resource' ? 'secondary' : 'outline'}>
                    {kb.source === 'skill_resource' ? t('sourceSkill') : t('sourceUpload')}
                  </Badge>
                </div>
                <CardDescription>{kb.description || t('noDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t('chunkCount', { count: kb.chunk_count })}
                </p>
              </CardContent>
              <CardFooter className="border-t gap-2">
                <Button
                  size="sm"
                  onClick={() => handleUploadClick(kb.id)}
                  disabled={uploadMutation.isPending && uploadTargetKbId === kb.id}
                >
                  <Upload className="size-3.5" />
                  {t('uploadButton')}
                </Button>
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
                      <AlertDialogTitle>{t('confirmDeleteTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('confirmDeleteDesc', { name: kb.name })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteTargetId(null)}
                      >
                        {t('common:cancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleDeleteConfirm}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
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
