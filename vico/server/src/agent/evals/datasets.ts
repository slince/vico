/**
 * 评估数据集管理模块
 *
 * 提供 Dataset 和 TestCase 的 CRUD 操作。
 * 所有操作通过 Drizzle ORM 执行，按 tenant_id 隔离。
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../db/db.js';
import { eval_datasets, eval_test_cases } from '../../db/schema.js';
import type { Dataset, TestCase } from './types.js';

/** 查询租户下所有数据集 */
export async function listDatasets(tenantId: string): Promise<Dataset[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(eval_datasets)
    .where(eq(eval_datasets.tenant_id, tenantId))
    .all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
  }));
}

/** 创建数据集 */
export async function createDataset(
  tenantId: string,
  data: { name: string; agentId: string },
): Promise<Dataset> {
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  await db.insert(eval_datasets).values({
    id,
    tenant_id: tenantId,
    name: data.name,
    agent_id: data.agentId,
    created_at: now,
  }).run();
  return { id, name: data.name, agentId: data.agentId, tenantId, createdAt: now };
}

/** 获取数据集详情 */
export async function getDataset(tenantId: string, datasetId: string): Promise<Dataset | null> {
  const db = getDb();
  const row = await db
    .select()
    .from(eval_datasets)
    .where(and(eq(eval_datasets.id, datasetId), eq(eval_datasets.tenant_id, tenantId)))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
  };
}

/**
 * 删除数据集。
 * 级联删除关联的测试用例（由 schema 层 onDelete: 'cascade' 保证）。
 */
export async function deleteDataset(tenantId: string, datasetId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(eval_datasets)
    .where(and(eq(eval_datasets.id, datasetId), eq(eval_datasets.tenant_id, tenantId)))
    .run();
  return result.rowsAffected > 0;
}

/** 向数据集添加测试用例 */
export async function addTestCase(
  datasetId: string,
  data: { input: string; expectedTools?: string[]; referenceAnswer?: string },
): Promise<TestCase> {
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  await db.insert(eval_test_cases).values({
    id,
    dataset_id: datasetId,
    input: data.input,
    expected_tools: data.expectedTools ? JSON.stringify(data.expectedTools) : null,
    reference_answer: data.referenceAnswer ?? null,
    created_at: now,
  }).run();
  return {
    id,
    datasetId,
    input: data.input,
    expectedTools: data.expectedTools,
    referenceAnswer: data.referenceAnswer,
    createdAt: now,
  };
}

/** 列出数据集的所有测试用例 */
export async function listTestCases(datasetId: string): Promise<TestCase[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(eval_test_cases)
    .where(eq(eval_test_cases.dataset_id, datasetId))
    .all();
  return rows.map((r) => ({
    id: r.id,
    datasetId: r.dataset_id,
    input: r.input,
    expectedTools: r.expected_tools ? JSON.parse(r.expected_tools as string) : undefined,
    referenceAnswer: r.reference_answer ?? undefined,
    createdAt: r.created_at,
  }));
}

/** 删除测试用例 */
export async function deleteTestCase(testCaseId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(eval_test_cases)
    .where(eq(eval_test_cases.id, testCaseId))
    .run();
  return result.rowsAffected > 0;
}
