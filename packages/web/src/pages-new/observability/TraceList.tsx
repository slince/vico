import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { fetchTraces, type TraceItem } from '@/api/observability';

export default function TraceList() {
  const [page, setPage] = useState(1);
  const perPage = 20;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['traces', page],
    queryFn: () => fetchTraces({ page, perPage }),
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">Traces</h1>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Traces</h1>
        <div className="mt-8 text-center text-destructive">
          <p>Failed to load traces</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  const traces = data?.traces ?? [];

  // Empty state
  if (traces.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Traces</h1>
        <div className="mt-8 text-center text-muted-foreground">
          <p className="text-lg">No traces yet</p>
          <p className="text-sm mt-1">Traces will appear here after agent conversations.</p>
        </div>
      </div>
    );
  }

  // Normal state
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Traces</h1>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trace ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces.map((trace: TraceItem) => (
            <TableRow key={trace.traceId}>
              <TableCell className="font-mono text-xs">{trace.traceId.slice(0, 12)}...</TableCell>
              <TableCell>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  trace.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}>
                  {trace.status || 'ok'}
                </span>
              </TableCell>
              <TableCell>{trace.latency ? `${(trace.latency / 1000).toFixed(2)}s` : '-'}</TableCell>
              <TableCell>{trace.createdAt ? new Date(trace.createdAt).toLocaleString() : '-'}</TableCell>
              <TableCell>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/observability/traces/${trace.traceId}`}>Detail</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Page {page} of {Math.ceil((data?.total ?? 0) / perPage) || 1}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={traces.length < perPage} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
