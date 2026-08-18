// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Trash2 } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { formatDateTime } from '@/lib/date-format';

// 5. Sub-components
import ThreadTableSkeleton from './threads/ThreadTableSkeleton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Thread {
  id: string;
  user_id: string;
  agent_id: string;
  agent_name?: string;
  message_count: number;
  model_name: string;
  updated_at: string;
}

interface Agent {
  id: string;
  name: string;
}

/**
 * Threads list page.
 *
 * Displays a searchable, filterable table of all user-Agent threads
 * across the current tenant. Each row links through to a thread detail
 * page (`/threads/:id`).
 *
 * States handled:
 * - loading – skeleton table rows
 * - empty   – Empty component with descriptive text
 * - error   – fallback message
 * - data    – fully populated table
 */
export default function Threads() {
  const { t } = useTranslation('threads');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Thread | null>(null);

  const {
    data: threads,
    isLoading: threadsLoading,
  } = useQuery<Thread[]>({
    queryKey: ['threads', search, agentFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (agentFilter) params.set('agent_id', agentFilter);
      return api(`/threads?${params.toString()}`);
    },
  });

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/threads/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      setDeleteTarget(null);
    },
  });

  const threadRows: Thread[] = threads ?? [];
  const agentsList: Agent[] = agents ?? [];

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    [],
  );

  const handleAgentFilterChange = useCallback((value: string) => {
    setAgentFilter(value === 'all' ? '' : value);
  }, []);

  if (threadsLoading) {
    return <ThreadTableSkeleton />;
  }

  if (!threads) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t('loadError')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
          />
        </div>

        <Select
          value={agentFilter || 'all'}
          onValueChange={handleAgentFilterChange}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('filterAll')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterAll')}</SelectItem>
            {agentsList.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {threadRows.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <Search size={24} className="text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>
            {search || agentFilter
              ? t('noMatchDescription')
              : t('emptyDescription')}
          </EmptyDescription>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('tableTitle')}</CardTitle>
            <CardDescription>
              {t('totalRecords', { count: threadRows.length })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columnUser')}</TableHead>
                  <TableHead>{t('columnAgent')}</TableHead>
                  <TableHead>{t('columnMessages')}</TableHead>
                  <TableHead>{t('columnModel')}</TableHead>
                  <TableHead>{t('columnTime')}</TableHead>
                  <TableHead>{t('columnActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {threadRows.map((thread) => (
                  <TableRow key={thread.id}>
                    <TableCell className="text-sm font-mono">
                      {thread.user_id?.slice(0, 8)}
                    </TableCell>

                    <TableCell className="text-sm">
                      {thread.agent_name ??
                        thread.agent_id?.slice(0, 8)}
                    </TableCell>

                    <TableCell className="text-sm">
                      {thread.message_count}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {thread.model_name}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(thread.updated_at)}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="link" size="sm" asChild>
                          <Link to={`/threads/${thread.id}`}>
                            {t('viewButton')}
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(thread)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('deleteCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {t('deleteConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
