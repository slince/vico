/**
 * Eval Runner — 异步评估执行引擎
 *
 * 负责：
 * 1. 接收 datasetId 和 tenantId，加载测试用例
 * 2. 对每个用例调用 Agent（agentProxy.generate()）获取回复
 * 3. 运行所有已注册的评分器对回复打分
 * 4. 将结果写入 eval_runs 和 eval_case_results 表
 * 5. 实时更新进度供轮询客户端读取
 *
 * 采用"提交即返回"模式：runEval() 返回 run 元数据后立即返回，
 * 实际执行在后台异步进行。同一 dataset 同时只允许一个评估运行。
 */

import { v4 as uuidv4 } from 'uuid';
import { prepareAgentContext } from '../agent.factory.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/db.js';
import { eval_runs, eval_case_results } from '../../db/schema.js';
import { mastra } from '../../mastra.js';
import { getScorer, listScorers } from './scorers.js';
import { listTestCases, getDataset } from './datasets.js';
import { RequestContext } from '@mastra/core/request-context';
import type { EvalRun, EvalCaseResult } from './types.js';
import logger from '../../lib/logger.js';

/** 跟踪正在执行的评估，防止同一数据集并发运行 */
const runningEvals = new Set<string>();

/**
 * 启动一次评估运行。
 *
 * 校验数据集存在且属于当前租户，加载测试用例，创建 run 记录后立即返回。
 * 实际 Agent 调用和评分在后台异步执行。
 *
 * @param tenantId - 租户 ID，用于数据隔离
 * @param datasetId - 数据集 ID
 * @returns 创建的 EvalRun 元数据
 * @throws 数据集不存在、无测试用例或已有评估正在运行时抛出
 */
export async function runEval(tenantId: string, datasetId: string): Promise<EvalRun> {
  // 校验数据集存在且属于当前租户
  const dataset = await getDataset(tenantId, datasetId);
  if (!dataset) {
    throw new Error('Dataset not found');
  }

  if (runningEvals.has(datasetId)) {
    throw new Error('An evaluation is already running for this dataset');
  }

  const cases = await listTestCases(datasetId);
  if (cases.length === 0) {
    throw new Error('Dataset has no test cases');
  }

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

  // 异步执行评估，不阻塞调用方
  executeEvalRun(tenantId, run, cases).catch((err) => {
    logger.error({ err, runId, datasetId }, 'Eval run failed');
    updateRunStatus(runId, 'failed');
    runningEvals.delete(datasetId);
  });

  return run;
}

/**
 * 后台执行评估：逐用例调用 Agent 并运行所有评分器。
 *
 * prepareAgentContext 通过动态 import 加载以避免循环依赖
 *（mastra → agent factory → runner → mastra）。
 */
async function executeEvalRun(
  tenantId: string,
  run: EvalRun,
  cases: Awaited<ReturnType<typeof listTestCases>>,
): Promise<void> {
  const db = getDb();

  // 收集各评分器的所有用例得分，用于最终计算平均分
  const allScores: Record<string, number[]> = {};

  const requestContext = new RequestContext();

  // 静态导入 — prepareAgentContext 已移至顶部 import
  for (const tc of cases) {
    try {
      // 1. 调用 Agent 获取回复
      // 使用 'main' 作为 agentId — main agent 是通用路由调度器
      const ctx = await prepareAgentContext(tenantId, 'main', requestContext);

      const startTime = Date.now();
      const result = await mastra.getAgent('agentProxy').generate(
        [{ role: 'user', content: tc.input }],
        {
          instructions: ctx.instructions,
          requestContext,
          maxSteps: 5,
        },
      );
      const output = result.text ?? '';
      const latency = Date.now() - startTime;

      // 提取实际工具调用列表（供 tool-call-accuracy 评分器使用）
      const actualTools: string[] | undefined = result.toolResults
        ?.map((tr: any) => tr.toolName)
        .filter(Boolean);

      // 2. 对当前用例运行所有已注册的评分器
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
            actualTools,
            referenceAnswer: tc.referenceAnswer,
          });
          scores[name] = scoreResult.score;
          details[name] = scoreResult.reason;
          if (!allScores[name]) allScores[name] = [];
          allScores[name].push(scoreResult.score);
        } catch (err) {
          logger.warn({ err, scorer: name, caseId: tc.id }, 'Scorer failed');
          scores[name] = 0;
          details[name] = 'Scorer execution failed';
        }
      }

      // 3. 存储用例评估结果
      await db.insert(eval_case_results).values({
        id: uuidv4(),
        run_id: run.id,
        case_id: tc.id,
        input: tc.input,
        actual_output: output,
        scores: JSON.stringify(scores),
        details: JSON.stringify(details),
        tool_calls: actualTools ? JSON.stringify(actualTools) : null,
        latency,
      }).run();

      // 4. 更新进度（供轮询客户端读取增量进度）
      run.completedCases++;
      await db
        .update(eval_runs)
        .set({ completed_cases: run.completedCases })
        .where(eq(eval_runs.id, run.id))
        .run();

    } catch (err) {
      logger.error({ err, caseId: tc.id }, 'Eval case failed');
    }
  }

  // 5. 计算最终评分并标记完成
  const scorerAverages: Record<string, number> = {};
  for (const [name, scoreList] of Object.entries(allScores)) {
    scorerAverages[name] = scoreList.length > 0
      ? scoreList.reduce((a, b) => a + b, 0) / scoreList.length
      : 0;
  }
  const overallScore = Object.values(scorerAverages).length > 0
    ? Object.values(scorerAverages).reduce((a, b) => a + b, 0) / Object.values(scorerAverages).length
    : 0;

  await db
    .update(eval_runs)
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

/** 将运行标记为失败 */
async function updateRunStatus(runId: string, status: 'failed'): Promise<void> {
  const db = getDb();
  await db
    .update(eval_runs)
    .set({ status, completed_at: Date.now() })
    .where(eq(eval_runs.id, runId))
    .run();
}

/**
 * 获取评估运行的完整详情，包含所有用例评分结果。
 *
 * @param runId - 评估运行 ID
 * @returns 包含 run 元数据和用例结果列表的对象，不存在时返回 null
 */
export async function getEvalRunDetail(runId: string): Promise<{
  run: EvalRun;
  cases: EvalCaseResult[];
} | null> {
  const db = getDb();
  const runRow = await db
    .select()
    .from(eval_runs)
    .where(eq(eval_runs.id, runId))
    .get();

  if (!runRow) return null;

  const caseRows = await db
    .select()
    .from(eval_case_results)
    .where(eq(eval_case_results.run_id, runId))
    .all();

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
