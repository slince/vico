import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchTraceDetail, type SpanNode } from '@/api/observability';

/** Recursive span tree renderer */
function SpanTree({ spans, depth = 0 }: { spans: SpanNode[]; depth?: number }) {
  return (
    <ul className={`space-y-1 ${depth > 0 ? 'ml-6 border-l border-border pl-4' : ''}`}>
      {spans.map((span) => {
        const duration = span.endTime - span.startTime;
        const maxBarWidth = 200;
        const barWidth = Math.max(4, Math.min(duration / 100, maxBarWidth));

        return (
          <li key={span.spanId} className="py-1">
            <div className="flex items-center gap-3">
              <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${
                span.type === 'tool_call' ? 'bg-blue-100 text-blue-700' :
                span.type === 'model' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {span.type}
              </span>
              <span className="text-sm font-medium">{span.name}</span>
              <span className="text-xs text-muted-foreground">{duration.toFixed(1)}ms</span>
              <div className="h-2 rounded bg-primary/30" style={{ width: barWidth }} />
            </div>
            {span.children && span.children.length > 0 && (
              <SpanTree spans={span.children} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();

  const { data: trace, isLoading, isError, error } = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetchTraceDetail(traceId!),
    enabled: !!traceId,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Trace Detail</h1>
        <div className="mt-8 text-center text-destructive">
          <p>Failed to load trace</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Trace Detail</h1>
        <div className="mt-8 text-center text-muted-foreground">
          <p>Trace not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trace Detail</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">{trace.traceId}</p>
      </div>

      {trace.metadata && Object.keys(trace.metadata).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(trace.metadata).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="font-medium text-muted-foreground">{key}:</dt>
                  <dd className="font-mono">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Span Tree</CardTitle>
        </CardHeader>
        <CardContent>
          {trace.spans && trace.spans.length > 0 ? (
            <SpanTree spans={trace.spans} />
          ) : (
            <p className="text-sm text-muted-foreground">No spans recorded.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
