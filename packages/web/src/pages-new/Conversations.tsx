import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useState, useCallback } from 'react';

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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a conversation row returned by GET /conversations */
interface Conversation {
  id: string;
  user_id: string;
  agent_id: string;
  agent_name?: string;
  message_count: number;
  model_name: string;
  updated_at: string;
}

/** Shape of an agent row returned by GET /agents */
interface Agent {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/**
 * Renders skeleton placeholder rows while the conversations query is loading.
 *
 * Uses five skeleton rows with the same column layout as the real table so the
 * visual jump when data arrives is minimal.
 */
function ConversationTableSkeleton() {
  // Build an array of 5 placeholder indices for skeleton rows
  const skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  return (
    <Card>
      <CardHeader>
        <CardTitle>对话记录</CardTitle>
        <CardDescription>所有用户与 Agent 的对话记录</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>消息数</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skeletonRows.map((idx) => (
              <TableRow key={idx}>
                {/* User column skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                {/* Agent column skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                {/* Message count skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-10" />
                </TableCell>
                {/* Model name skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                {/* Timestamp skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-36" />
                </TableCell>
                {/* Actions skeleton */}
                <TableCell>
                  <Skeleton className="h-8 w-12 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

/**
 * Conversations list page.
 *
 * Displays a searchable, filterable table of all user-Agent conversations
 * across the current tenant. Each row links through to a conversation detail
 * page (`/conversations/:id`).
 *
 * States handled:
 * - **loading** – skeleton table rows
 * - **empty**   – Empty component with descriptive text
 * - **error**   – queried data is `undefined` and not loading (edge-case guard)
 * - **data**    – fully populated table
 */
export default function Conversations() {
  // ---- local filter state ------------------------------------------------
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');

  // ---- queries -----------------------------------------------------------

  /** Fetch the filtered conversations list */
  const {
    data: conversations,
    isLoading: conversationsLoading,
  } = useQuery<Conversation[]>({
    queryKey: ['conversations', search, agentFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search); // full-text search term
      if (agentFilter) params.set('agent_id', agentFilter); // filter by agent
      return api(`/conversations?${params.toString()}`);
    },
  });

  /** Fetch the agents list (used to populate the filter dropdown) */
  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  // ---- derived values ----------------------------------------------------

  /** Guard against undefined data – treat as empty array */
  const convs: Conversation[] = conversations ?? [];
  const agentsList: Agent[] = agents ?? [];

  // ---- event handlers ---------------------------------------------------

  /**
   * Updates the search term state.
   * Uses `useCallback` to keep a stable reference across renders.
   */
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    [],
  );

  /**
   * Updates the agent filter state. An empty string means "all agents".
   * Uses `useCallback` to keep a stable reference across renders.
   */
  const handleAgentFilterChange = useCallback((value: string) => {
    // The Select component passes the raw value string; "all" resets the filter
    setAgentFilter(value === 'all' ? '' : value);
  }, []);

  // ---- loading state -----------------------------------------------------
  if (conversationsLoading) {
    return <ConversationTableSkeleton />;
  }

  // ---- error / edge-case state -------------------------------------------
  // If not loading but data is undefined (e.g. a 500 from the API), show a
  // fallback message rather than a blank page.
  if (!conversations) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        无法加载对话记录，请稍后重试
      </div>
    );
  }

  // ---- render ------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <h2 className="text-2xl font-bold tracking-tight">对话记录</h2>

      {/* Search + filter toolbar */}
      <div className="flex gap-3 items-center">
        {/* Search input with leading icon */}
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="搜索对话..."
            className="pl-9"
          />
        </div>

        {/* Agent filter dropdown */}
        <Select
          value={agentFilter || 'all'}
          onValueChange={handleAgentFilterChange}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="全部 Agent" />
          </SelectTrigger>
          <SelectContent>
            {/* Default "all agents" option */}
            <SelectItem value="all">全部 Agent</SelectItem>
            {agentsList.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty state – shown when the filtered list is empty */}
      {convs.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <Search size={24} className="text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>暂无对话记录</EmptyTitle>
          <EmptyDescription>
            {search || agentFilter
              ? '没有匹配的对话记录，试试调整筛选条件'
              : '还没有任何对话记录'}
          </EmptyDescription>
        </Empty>
      ) : (
        /* Data table wrapped in a Card */
        <Card>
          <CardHeader>
            <CardTitle>对话记录</CardTitle>
            <CardDescription>
              共 {convs.length} 条对话记录
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>消息数</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {convs.map((conversation) => (
                  <TableRow key={conversation.id}>
                    {/* Display truncated user ID as identifier */}
                    <TableCell className="text-sm font-mono">
                      {conversation.user_id?.slice(0, 8)}
                    </TableCell>

                    {/* Agent name falls back to truncated agent ID */}
                    <TableCell className="text-sm">
                      {conversation.agent_name ??
                        conversation.agent_id?.slice(0, 8)}
                    </TableCell>

                    {/* Message count */}
                    <TableCell className="text-sm">
                      {conversation.message_count}
                    </TableCell>

                    {/* Model name */}
                    <TableCell className="text-xs text-muted-foreground">
                      {conversation.model_name}
                    </TableCell>

                    {/* Formatted update timestamp (zh-CN locale) */}
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(conversation.updated_at).toLocaleString(
                        'zh-CN',
                      )}
                    </TableCell>

                    {/* Link to conversation detail */}
                    <TableCell>
                      <Button variant="link" size="sm" asChild>
                        <Link to={`/conversations/${conversation.id}`}>
                          查看
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
