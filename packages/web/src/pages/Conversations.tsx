// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';

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
import { formatDateTime } from '@/lib/date-format';

// 5. Sub-components
import ConversationTableSkeleton from './conversations/ConversationTableSkeleton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Conversation {
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
 * Conversations list page.
 *
 * Displays a searchable, filterable table of all user-Agent conversations
 * across the current tenant. Each row links through to a conversation detail
 * page (`/conversations/:id`).
 *
 * States handled:
 * - loading – skeleton table rows
 * - empty   – Empty component with descriptive text
 * - error   – fallback message
 * - data    – fully populated table
 */
export default function Conversations() {
  const { t } = useTranslation('conversations');

  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');

  const {
    data: conversations,
    isLoading: conversationsLoading,
  } = useQuery<Conversation[]>({
    queryKey: ['conversations', search, agentFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (agentFilter) params.set('agent_id', agentFilter);
      return api(`/conversations?${params.toString()}`);
    },
  });

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const convs: Conversation[] = conversations ?? [];
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

  if (conversationsLoading) {
    return <ConversationTableSkeleton />;
  }

  if (!conversations) {
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

      {convs.length === 0 ? (
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
              {t('totalRecords', { count: convs.length })}
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
                {convs.map((conversation) => (
                  <TableRow key={conversation.id}>
                    <TableCell className="text-sm font-mono">
                      {conversation.user_id?.slice(0, 8)}
                    </TableCell>

                    <TableCell className="text-sm">
                      {conversation.agent_name ??
                        conversation.agent_id?.slice(0, 8)}
                    </TableCell>

                    <TableCell className="text-sm">
                      {conversation.message_count}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {conversation.model_name}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(conversation.updated_at)}
                    </TableCell>

                    <TableCell>
                      <Button variant="link" size="sm" asChild>
                        <Link to={`/conversations/${conversation.id}`}>
                          {t('viewButton')}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
