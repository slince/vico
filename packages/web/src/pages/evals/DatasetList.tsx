// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Eye, Database } from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';
import {
  fetchDatasets,
  createDatasetApi,
  deleteDatasetApi,
  type DatasetItem,
} from '@/api/evals';

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
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

/** Agent 数据形状（来自 API，仅用到 id 和 name） */
interface AgentItem {
  id: string;
  name: string;
  enabled: boolean;
}

/**
 * Evals Dataset 列表页
 *
 * 以卡片网格展示所有评测数据集，支持创建和删除操作。
 * 加载时展示 Skeleton 骨架屏，无数据时展示 Empty 空状态。
 */
export default function DatasetList() {
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DatasetItem | null>(null);

  /** 拉取数据集列表 */
  const { data: datasets, isLoading, isError, error } = useQuery<DatasetItem[]>({
    queryKey: ['eval-datasets'],
    queryFn: fetchDatasets,
  });

  /** 拉取 Agent 列表（供选择器使用） */
  const { data: agents } = useQuery<AgentItem[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; agentId: string }) =>
      createDatasetApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-datasets'] });
      setCreateOpen(false);
      setNewName('');
      setNewAgentId('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDatasetApi(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eval-datasets'] }),
  });

  const handleCreate = useCallback(() => {
    if (!newName.trim() || !newAgentId) return;
    createMutation.mutate({ name: newName.trim(), agentId: newAgentId });
  }, [newName, newAgentId, createMutation]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id, {
        onSettled: () => setDeleteTarget(null),
      });
    }
  }, [deleteTarget, deleteMutation]);

  const datasetList: DatasetItem[] = datasets || [];
  const agentList: AgentItem[] = agents || [];

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Eval Datasets</h2>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-20 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mt-2" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-full rounded-md" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ====================== 错误态 ======================
  if (isError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Eval Datasets</h2>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load datasets</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  // ====================== 空状态 ======================
  if (datasetList.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Eval Datasets</h2>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus size={16} className="mr-2" />
                New Dataset
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Dataset</DialogTitle>
                <DialogDescription>
                  Create a new evaluation dataset to organize test cases.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="dataset-name">Name</Label>
                  <Input
                    id="dataset-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Customer Support QA"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dataset-agent">Agent</Label>
                  <NativeSelect
                    id="dataset-agent"
                    value={newAgentId}
                    onChange={(e) => setNewAgentId(e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="" disabled>
                      Select an agent...
                    </NativeSelectOption>
                    {agentList
                      .filter((a) => a.enabled)
                      .map((a) => (
                        <NativeSelectOption key={a.id} value={a.id}>
                          {a.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </div>

                {createMutation.error && (
                  <p className="text-sm text-destructive">
                    {(createMutation.error as Error).message}
                  </p>
                )}
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  onClick={handleCreate}
                  disabled={!newName.trim() || !newAgentId || createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Empty>
          <EmptyMedia variant="icon">
            <Database size={32} />
          </EmptyMedia>
          <EmptyTitle>No datasets yet</EmptyTitle>
          <EmptyDescription>
            Create your first evaluation dataset to start measuring agent performance.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // ====================== 正常数据态 ======================
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Eval Datasets</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} className="mr-2" />
              New Dataset
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Dataset</DialogTitle>
              <DialogDescription>
                Create a new evaluation dataset to organize test cases.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="dataset-name">Name</Label>
                <Input
                  id="dataset-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Customer Support QA"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataset-agent">Agent</Label>
                <NativeSelect
                  id="dataset-agent"
                  value={newAgentId}
                  onChange={(e) => setNewAgentId(e.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="" disabled>
                    Select an agent...
                  </NativeSelectOption>
                  {agentList
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <NativeSelectOption key={a.id} value={a.id}>
                        {a.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>

              {createMutation.error && (
                <p className="text-sm text-destructive">
                  {(createMutation.error as Error).message}
                </p>
              )}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={!newName.trim() || !newAgentId || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {datasetList.map((dataset) => (
          <Card
            key={dataset.id}
            className="hover:shadow-md transition-shadow group/card"
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/evals/datasets/${dataset.id}`}
                    className="hover:text-primary transition-colors"
                  >
                    <CardTitle className="text-base truncate">
                      {dataset.name}
                    </CardTitle>
                  </Link>
                  <CardDescription className="mt-1">
                    Agent: {dataset.agentId}
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {dataset.cases?.length ?? 0} cases
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="pb-2">
              <p className="text-xs text-muted-foreground">
                Created: {new Date(dataset.createdAt).toLocaleString()}
              </p>
            </CardContent>

            <Separator />

            <CardFooter className="pt-3 pb-3 flex items-center justify-between">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/evals/datasets/${dataset.id}`}>
                  <Eye size={14} className="mr-1.5" />
                  View Cases
                </Link>
              </Button>
              <AlertDialog
                open={deleteTarget?.id === dataset.id}
                onOpenChange={(open) => {
                  if (!open) setDeleteTarget(null);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(dataset)}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Dataset</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{dataset.name}"? This action cannot be undone
                      and will remove all associated test cases.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setDeleteTarget(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteConfirm}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
