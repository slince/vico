// 1. React
import { useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// 3. API
import { api } from '@/api/client';

// 4. UI 组件
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import AddUserDialog from './AddUserDialog';

/** 用户列表条目 */
interface UserEntry {
  id: string;
  username: string | null;
  displayUsername: string | null;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

/** 用户管理 section：列表 + 新增成员 + 删除成员（仅 admin 可见） */
export default function UserManagement() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserEntry | null>(null);

  const { data: users, isLoading, isError } = useQuery<UserEntry[]>({
    queryKey: ['users'],
    queryFn: () => api('/users'),
  });

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api('/users', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setAddOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setDeleteTarget(null);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-72 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-muted-foreground">{t('common:operationFailed')}</p>;
  }

  const list = users || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('users.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('users.description')}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              {t('users.addUser')}
            </Button>
          </DialogTrigger>
          <AddUserDialog
            onSubmit={(data) => addMutation.mutate(data)}
            isPending={addMutation.isPending}
          />
        </Dialog>
      </div>

      {list.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('users.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('users.emptyDescription')}</EmptyDescription>
        </Empty>
      ) : (
        <div className="space-y-3">
          {list.map((u) => (
            <Card key={u.id}>
              <CardContent className="py-0">
                <div className="flex items-center justify-between py-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {u.displayUsername || u.username || u.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {u.username} · {u.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? t('users.roleAdmin') : t('users.roleUser')}
                    </Badge>
                    <AlertDialog
                      open={deleteTarget?.id === u.id}
                      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('users.confirmDeleteTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('users.confirmDeleteDesc', { name: u.displayUsername || u.username || u.name })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                            {t('common:cancel')}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(u.id)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
