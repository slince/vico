/**
 * Eval Runner — 异步评估执行引擎（不再依赖 Mastra）。
 */
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/db.js';
import { eval_runs, eval_case_results } from '../../db/schema.js';
import { executeAgentChat } from '../../chat/chat.js';
import { getScorer, listScorers } from './scorers.js';
import { listTestCases, getDataset } from './datasets.js';
import type { EvalRun, EvalCaseResult } from './types.js';
import logger from '../../lib/logger.js';

const runningEvals = new Set<string>();

export async function runEval(tenantId: string, datasetId: string): Promise<EvalRun> {
  const dataset = await getDataset(tenantId, datasetId);
  if (!dataset) throw new Error('Dataset not found');

  if (runningEvals.has(datasetId)) {
    throw new Error('An evaluation is already running for this dataset');
  }

  const cases = await listTestCases(datasetId);
  if (cases.length === 0) throw new Error('Dataset has no test cases');

  const db = getDb();
  const now = Date.now();
  const runId = uuidv4();

  const run: EvalRun = {
    id: runId,
    datasetId,
    status: 'running',
    totalCases: cases.length,
    completedCases: 0,
    overallScore: null,
    scorerScores: {},
    createdAt: now,
    completedAt: null,
  };

  await db.insert(eval_runs).values({
    id: run.id,
    dataset_id: datasetId,
    status: 'running',
    total_cases: cases.length,
    completed_cases: 0,
    created_at: now,
  }).run();

  runningEvals.add(datasetId);

  executeEvalRun(tenantId, run, cases).catch((err) => {
    logger.error({ err, runId, datasetId }, 'Eval run failed');
    updateRunStatus(runId, 'failed');
    runningEvals.delete(datasetId);
  });

  return run;
}

async function executeEvalRun(
  tenantId: string,
  run: EvalRun,
  cases: Awaited<ReturnType<typeof listTestCases>>,
): Promise<void> {
  const db = getDb();
  const allScores: Record<string, number[]> = {};

  for (const tc of cases) {
    try {
      const startTime = Date.now();
      let output = '';

      // 使用 Vico Agent 执行
      const result = await executeAgentChat({
        agentId: 'main',
        message: tc.input,
        threadId: `eval-${run.id}-${tc.id}`,
        tenantId,
        userId: 'eval',
      });

      while (true) {
        const { done, value } = await result.stream.next();
        if (done) break;
        if (value.type === 'text_delta') output += value.content;
      }

      const latency = Date.now() - startTime;

      // 评分
      const scores: Record<string, number> = {};
      const details: Record<string, string> = {};
      const scorerNames = listScorers();

      for (const name of scorerNames) {
        const scorer = getScorer(name);
        if (!scorer) continue;
        try {
          const scoreResult = await scorer({
            input: tc.input,
            output,
            expectedTools: tc.expectedTools,
            referenceAnswer: tc.referenceAnswer,
          });
          scores[name] = scoreResult.score;
          details[name] = scoreResult.reason;
          if (!allScores[name]) allScores[name] = [];
          allScores[name].push(scoreResult.score);
        } catch (err) {
          logger.warn({ err, scorer: name }, 'Scorer failed');
          scores[name] = 0;
          details[name] = 'Scorer execution failed';
        }
      }

      await db.insert(eval_case_results).values({
        id: uuidv4(),
        run_id: run.id,
        case_id: tc.id,
        input: tc.input,
        actual_output: output,
        scores: JSON.stringify(scores),
        details: JSON.stringify(details),
        latency,
      }).run();

      run.completedCases++;
      await db.update(eval_runs)
        .set({ completed_cases: run.completedCases })
        .where(eq(eval_runs.id, run.id))
        .run();

    } catch (err) {
      logger.error({ err, caseId: tc.id }, 'Eval case failed');
    }
  }

  const scorerAverages: Record<string, number> = {};
  for (const [name, scoreList] of Object.entries(allScores)) {
    scorerAverages[name] = scoreList.length > 0
      ? scoreList.reduce((a, b) => a + b, 0) / scoreList.length : 0;
  }
  const overallScore = Object.values(scorerAverages).length > 0
    ? Object.values(scorerAverages).reduce((a, b) => a + b, 0) / Object.values(scorerAverages).length : 0;

  await db.update(eval_runs)
    .set({
      status: 'completed',
      overall_score: overallScore,
      scorer_scores: JSON.stringify(scorerAverages),
      completed_cases: run.completedCases,
      completed_at: Date.now(),
    })
    .where(eq(eval_runs.id, run.id))
    .run();

  runningEvals.delete(run.datasetId);
}

async function updateRunStatus(runId: string, status: 'failed'): Promise<void> {
  const db = getDb();
  await db.update(eval_runs)
    .set({ status, completed_at: Date.now() })
    .where(eq(eval_runs.id, runId))
    .run();
}

export async function getEvalRunDetail(runId: string): Promise<{
  run: EvalRun;
  cases: EvalCaseResult[];
} | null> {
  const db = getDb();
  const runRow = await db.select().from(eval_runs).where(eq(eval_runs.id, runId)).get();
  if (!runRow) return null;

  const caseRows = await db.select().from(eval_case_results)
    .where(eq(eval_case_results.run_id, runId)).all();

  return {
    run: {
      id: runRow.id,
      datasetId: runRow.dataset_id,
      status: runRow.status as 'running' | 'completed' | 'failed',
      totalCases: runRow.total_cases,
      completedCases: runRow.completed_cases,
      overallScore: runRow.overall_score,
      scorerScores: runRow.scorer_scores ? JSON.parse(runRow.scorer_scores as string) : {},
      createdAt: runRow.created_at,
      completedAt: runRow.completed_at,
    },
    cases: caseRows.map(r => ({
      caseId: r.case_id,
      input: r.input,
      actualOutput: r.actual_output,
      scores: r.scores ? JSON.parse(r.scores as string) : {},
      details: r.details ? JSON.parse(r.details as string) : {},
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls as string) : undefined,
      latency: r.latency,
    })),
  };
}
