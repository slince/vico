// 1. React
import { useMemo } from 'react';

// 2. Third-party
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
} from 'recharts';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

// 3. API / Hooks / Utils
import {
  fetchEvalRunDetail,
  type EvalRunDetail,
  type EvalCaseResultItem,
} from '@/api/evals';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * 根据分数返回颜色类名
 *
 * @param score - 0-1 之间的分数值
 * @returns Tailwind 颜色类名
 */
function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-green-600 bg-green-50';
  if (score >= 0.6) return 'text-yellow-600 bg-yellow-50';
  return 'text-red-600 bg-red-50';
}

/**
 * Eval Run 结果页
 *
 * 展示单次评测运行的详细结果，包括：
 * - 运行状态与进度
 * - 雷达图展示各 Scorer 分数
 * - 各测试用例的详细得分表格
 *
 * 运行中时自动轮询（3 秒间隔），完成后停止。
 */
export default function EvalRun() {
  const { id } = useParams<{ id: string }>();

  const { data: run, isLoading, isError, error } = useQuery<EvalRunDetail>({
    queryKey: ['eval-run', id],
    queryFn: () => fetchEvalRunDetail(id!),
    enabled: !!id,
    /** 运行中时每 3 秒轮询一次 */
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 3000 : false,
  });

  /** 将 scorerScores 转为 Recharts radar 数据格式 */
  const radarData = useMemo(() => {
    if (!run?.scorerScores) return [];
    return Object.entries(run.scorerScores).map(([name, score]) => ({
      scorer: name,
      score: Math.round(score * 100),
    }));
  }, [run?.scorerScores]);

  /** 进度百分比 */
  const progressPercent = useMemo(() => {
    if (!run || run.totalCases === 0) return 0;
    return Math.round((run.completedCases / run.totalCases) * 100);
  }, [run]);

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4 mb-6" />
            <Skeleton className="h-[300px] w-full rounded-lg" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-32 mb-4" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full mb-2" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ====================== 错误态 ======================
  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/evals/datasets" aria-label="Back to datasets">
              <ArrowLeft size={20} />
            </Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">Eval Run</h2>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load eval run</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  // ====================== 未找到 ======================
  if (!run) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/evals/datasets" aria-label="Back to datasets">
              <ArrowLeft size={20} />
            </Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">Eval Run</h2>
        </div>
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Eval run not found.</p>
        </div>
      </div>
    );
  }

  /** 状态 Badge 配置 */
  const statusConfig: Record<string, { icon: React.ReactNode; label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
    running: { icon: <Loader2 size={14} className="animate-spin" />, label: 'Running', variant: 'default' },
    completed: { icon: <CheckCircle2 size={14} />, label: 'Completed', variant: 'secondary' },
    failed: { icon: <XCircle size={14} />, label: 'Failed', variant: 'destructive' },
  };
  const status = statusConfig[run.status] || statusConfig.failed;

  // ====================== 正常数据态 ======================
  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/evals/datasets" aria-label="Back to datasets">
            <ArrowLeft size={20} />
          </Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">
            Eval Run{' '}
            <span className="text-base font-mono text-muted-foreground">
              {run.id.slice(0, 8)}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Dataset: {run.datasetId}
          </p>
        </div>
      </div>

      {/* 状态信息卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Overview</CardTitle>
            <Badge variant={status.variant} className="flex items-center gap-1.5">
              {status.icon}
              {status.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 进度条 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">
                {run.completedCases} / {run.totalCases} cases
              </span>
            </div>
            <Progress value={progressPercent} />
          </div>

          <div className="flex items-center gap-6">
            {/* 总体分数 */}
            <div>
              <p className="text-sm text-muted-foreground">Overall Score</p>
              <p className="text-3xl font-bold tabular-nums">
                {run.overallScore != null ? `${Math.round(run.overallScore * 100)}%` : '--'}
              </p>
            </div>
            {/* 创建时间 */}
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="text-sm font-medium">
                {new Date(run.createdAt).toLocaleString()}
              </p>
            </div>
            {/* 完成时间 */}
            {run.completedAt && (
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-sm font-medium">
                  {new Date(run.completedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 雷达图 — 仅在非 running 且有 scorerScores 时展示 */}
      {run.status !== 'running' && radarData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scorer Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="scorer" />
                <PolarRadiusAxis angle={30} domain={[0, 100]} />
                <Radar
                  name="Score"
                  dataKey="score"
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 运行时显示等待提示 */}
      {run.status === 'running' && (
        <Card>
          <CardContent className="p-6 text-center">
            <Loader2 size={24} className="animate-spin mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Evaluation in progress... Results will appear as cases complete.
            </p>
          </CardContent>
        </Card>
      )}

      {/* 各用例详细结果表格 */}
      {run.cases && run.cases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Case Details</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Input</TableHead>
                  <TableHead className="w-[30%]">Output</TableHead>
                  <TableHead>Scores</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.cases.map((cr: EvalCaseResultItem) => (
                  <TableRow key={cr.caseId}>
                    {/* 输入预览 */}
                    <TableCell className="max-w-[200px]">
                      <p className="text-xs whitespace-pre-wrap line-clamp-3">
                        {cr.input}
                      </p>
                    </TableCell>

                    {/* 输出预览 */}
                    <TableCell className="max-w-[200px]">
                      <p className="text-xs whitespace-pre-wrap line-clamp-3 text-muted-foreground">
                        {cr.actualOutput || '--'}
                      </p>
                    </TableCell>

                    {/* Scorer 分数 */}
                    <TableCell>
                      {cr.scores && Object.keys(cr.scores).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(cr.scores).map(([scorer, score]) => (
                            <Badge
                              key={scorer}
                              variant="outline"
                              className={`text-xs ${scoreColor(score)}`}
                            >
                              {scorer}: {Math.round(score * 100)}%
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>

                    {/* 延迟 */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                        <Clock size={12} />
                        {(cr.latency / 1000).toFixed(2)}s
                      </div>
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
