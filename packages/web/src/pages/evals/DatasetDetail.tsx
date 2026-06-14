// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Play, MessageSquare, FileText, Database,
} from 'lucide-react';

// 3. API / Hooks / Utils
import {
  fetchDatasetDetail,
  addTestCaseApi,
  runEvalApi,
  type DatasetItem,
  type TestCaseItem,
} from '@/api/evals';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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

/**
 * Dataset 详情页
 *
 * 展示单个数据集的所有测试用例，支持添加用例、运行评测。
 * 加载时展示 Skeleton，无用例时展示 Empty 空状态。
 */
export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [caseInput, setCaseInput] = useState('');
  const [referenceAnswer, setReferenceAnswer] = useState('');

  /** 拉取数据集详情（包含测试用例） */
  const {
    data: dataset,
    isLoading,
    isError,
    error,
  } = useQuery<DatasetItem>({
    queryKey: ['eval-dataset', id],
    queryFn: () => fetchDatasetDetail(id!),
    enabled: !!id,
  });

  const addCaseMutation = useMutation({
    mutationFn: (data: { input: string; referenceAnswer?: string }) =>
      addTestCaseApi(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-dataset', id] });
      setAddOpen(false);
      setCaseInput('');
      setReferenceAnswer('');
    },
  });

  const runEvalMutation = useMutation({
    mutationFn: () => runEvalApi(id!),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['eval-datasets'] });
      navigate(`/evals/runs/${run.id}`);
    },
  });

  const handleAddCase = useCallback(() => {
    if (!caseInput.trim()) return;
    addCaseMutation.mutate({
      input: caseInput.trim(),
      referenceAnswer: referenceAnswer.trim() || undefined,
    });
  }, [caseInput, referenceAnswer, addCaseMutation]);

  const handleRunEval = useCallback(() => {
    runEvalMutation.mutate();
  }, [runEvalMutation]);

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
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mt-2" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardContent>
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
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/evals/datasets" aria-label="Back to datasets">
              <ArrowLeft size={20} />
            </Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">Dataset Detail</h2>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load dataset</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  // ====================== 未找到 ======================
  if (!dataset) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/evals/datasets" aria-label="Back to datasets">
              <ArrowLeft size={20} />
            </Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">Dataset Detail</h2>
        </div>
        <Empty>
          <EmptyMedia variant="icon">
            <Database size={32} />
          </EmptyMedia>
          <EmptyTitle>Dataset not found</EmptyTitle>
          <EmptyDescription>
            The requested dataset could not be found.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  const cases: TestCaseItem[] = dataset.cases || [];

  // ====================== 空用例状态 ======================
  if (cases.length === 0) {
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
            <h2 className="text-2xl font-bold tracking-tight">{dataset.name}</h2>
            <p className="text-sm text-muted-foreground">
              Agent: {dataset.agentId} &middot; {cases.length} test cases
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus size={14} className="mr-1.5" />
                  Add Case
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Test Case</DialogTitle>
                  <DialogDescription>
                    Define the input and optional reference answer for this test case.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="case-input">User Input</Label>
                    <Textarea
                      id="case-input"
                      value={caseInput}
                      onChange={(e) => setCaseInput(e.target.value)}
                      placeholder="What should the user say to the agent?"
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="case-reference">Reference Answer (optional)</Label>
                    <Textarea
                      id="case-reference"
                      value={referenceAnswer}
                      onChange={(e) => setReferenceAnswer(e.target.value)}
                      placeholder="Expected response from the agent..."
                      rows={3}
                    />
                  </div>

                  {addCaseMutation.error && (
                    <p className="text-sm text-destructive">
                      {(addCaseMutation.error as Error).message}
                    </p>
                  )}
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    onClick={handleAddCase}
                    disabled={!caseInput.trim() || addCaseMutation.isPending}
                  >
                    {addCaseMutation.isPending ? 'Adding...' : 'Add'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button
              size="sm"
              onClick={handleRunEval}
              disabled={runEvalMutation.isPending}
            >
              <Play size={14} className="mr-1.5" />
              {runEvalMutation.isPending ? 'Running...' : 'Run Eval'}
            </Button>
          </div>
        </div>

        <Empty>
          <EmptyMedia variant="icon">
            <MessageSquare size={32} />
          </EmptyMedia>
          <EmptyTitle>No test cases yet</EmptyTitle>
          <EmptyDescription>
            Add test cases to this dataset to start evaluating your agent.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

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
          <h2 className="text-2xl font-bold tracking-tight">{dataset.name}</h2>
          <p className="text-sm text-muted-foreground">
            Agent: {dataset.agentId} &middot; {cases.length} test cases
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus size={14} className="mr-1.5" />
                Add Case
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Test Case</DialogTitle>
                <DialogDescription>
                  Define the input and optional reference answer for this test case.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="case-input">User Input</Label>
                  <Textarea
                    id="case-input"
                    value={caseInput}
                    onChange={(e) => setCaseInput(e.target.value)}
                    placeholder="What should the user say to the agent?"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="case-reference">Reference Answer (optional)</Label>
                  <Textarea
                    id="case-reference"
                    value={referenceAnswer}
                    onChange={(e) => setReferenceAnswer(e.target.value)}
                    placeholder="Expected response from the agent..."
                    rows={3}
                  />
                </div>

                {addCaseMutation.error && (
                  <p className="text-sm text-destructive">
                    {(addCaseMutation.error as Error).message}
                  </p>
                )}
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  onClick={handleAddCase}
                  disabled={!caseInput.trim() || addCaseMutation.isPending}
                >
                  {addCaseMutation.isPending ? 'Adding...' : 'Add'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            size="sm"
            onClick={handleRunEval}
            disabled={runEvalMutation.isPending}
          >
            <Play size={14} className="mr-1.5" />
            {runEvalMutation.isPending ? 'Running...' : 'Run Eval'}
          </Button>
        </div>
      </div>

      {/* 测试用例列表 */}
      <div className="space-y-3">
        {cases.map((tc) => (
          <Card key={tc.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Test Case</CardTitle>
                {tc.expectedTools && tc.expectedTools.length > 0 && (
                  <div className="flex items-center gap-1 ml-2">
                    {tc.expectedTools.map((tool) => (
                      <Badge key={tool} variant="outline" className="text-xs">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Input</p>
                <p className="text-sm whitespace-pre-wrap">{tc.input}</p>
              </div>
              {tc.referenceAnswer && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Reference Answer</p>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {tc.referenceAnswer}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
