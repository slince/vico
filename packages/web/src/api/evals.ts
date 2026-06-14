/**
 * Evals API 客户端
 */
import { api } from './client';

export interface DatasetItem {
  id: string;
  name: string;
  agentId: string;
  createdAt: number;
  cases?: TestCaseItem[];
}

export interface TestCaseItem {
  id: string;
  datasetId: string;
  input: string;
  expectedTools?: string[];
  referenceAnswer?: string;
}

export interface EvalRunItem {
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

export interface EvalCaseResultItem {
  caseId: string;
  input: string;
  actualOutput: string;
  scores: Record<string, number>;
  details: Record<string, string>;
  toolCalls?: string[];
  latency: number;
}

export interface EvalRunDetail extends EvalRunItem {
  cases: EvalCaseResultItem[];
}

export function fetchDatasets(): Promise<DatasetItem[]> {
  return api('/evals/datasets');
}

export function createDatasetApi(data: { name: string; agentId: string }): Promise<DatasetItem> {
  return api('/evals/datasets', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteDatasetApi(id: string): Promise<void> {
  return api(`/evals/datasets/${id}`, { method: 'DELETE' });
}

export function fetchDatasetDetail(id: string): Promise<DatasetItem> {
  return api(`/evals/datasets/${id}`);
}

export function addTestCaseApi(datasetId: string, data: {
  input: string;
  expectedTools?: string[];
  referenceAnswer?: string;
}): Promise<TestCaseItem> {
  return api(`/evals/datasets/${datasetId}/cases`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function runEvalApi(datasetId: string): Promise<EvalRunItem> {
  return api(`/evals/datasets/${datasetId}/run`, { method: 'POST' });
}

export function fetchEvalRunDetail(runId: string): Promise<EvalRunDetail> {
  return api(`/evals/runs/${runId}`);
}
