/**
 * Evals 评估类型定义
 *
 * 定义 Dataset, TestCase, EvalRun, EvalCaseResult 等核心类型。
 */

export interface Dataset {
  id: string;
  name: string;
  agentId: string;
  tenantId: string;
  createdAt: number;
}

export interface TestCase {
  id: string;
  datasetId: string;
  input: string;
  expectedTools?: string[];
  referenceAnswer?: string;
  createdAt: number;
}

export interface EvalRun {
  id: string;
  datasetId: string;
  status: 'running' | 'completed' | 'failed';
  totalCases: number;
  completedCases: number;
  overallScore: number | null;
  scorerScores: Record<string, number>;
  createdAt: number;
  completedAt: number | null;
}

export interface EvalCaseResult {
  caseId: string;
  input: string;
  actualOutput: string;
  scores: Record<string, number>;
  details: Record<string, string>;
  toolCalls?: string[];
  latency: number;
}

export interface EvalRunDetail extends EvalRun {
  cases: EvalCaseResult[];
}
