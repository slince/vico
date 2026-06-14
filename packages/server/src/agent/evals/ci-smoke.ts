/**
 * CI 评估冒烟测试
 *
 * 对核心 agent 运行最小数据集，总分低于阈值时退出非零。
 * 用法: npx tsx src/agent/evals/ci-smoke.ts
 */
import { runEval, getEvalRunDetail } from './runner.js';
import { createDataset, addTestCase, deleteDataset } from './datasets.js';

const SMOKE_THRESHOLD = 0.6;
const TENANT_ID = 'default';
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120000;

async function main() {
  console.log('Creating smoke test dataset...');

  const dataset = await createDataset(TENANT_ID, {
    name: `ci-smoke-${Date.now()}`,
    agentId: 'main',
  });

  await addTestCase(dataset.id, {
    input: 'What is 2+2?',
    referenceAnswer: '4',
  });
  await addTestCase(dataset.id, {
    input: 'Say hello in one sentence.',
    referenceAnswer: 'Hello!',
  });
  await addTestCase(dataset.id, {
    input: 'What is the capital of France?',
    referenceAnswer: 'Paris',
  });

  console.log('Running eval...');
  const run = await runEval(TENANT_ID, dataset.id);

  // Wait for completion
  const startTime = Date.now();
  let detail = await getEvalRunDetail(run.id);

  while (detail?.run.status === 'running' && Date.now() - startTime < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    detail = await getEvalRunDetail(run.id);
  }

  // Cleanup
  await deleteDataset(TENANT_ID, dataset.id);

  if (!detail || detail.run.status !== 'completed') {
    console.error('Eval did not complete in time');
    process.exit(1);
  }

  const score = detail.run.overallScore ?? 0;
  console.log(`Overall score: ${(score * 100).toFixed(1)}% (threshold: ${(SMOKE_THRESHOLD * 100).toFixed(0)}%)`);

  if (score < SMOKE_THRESHOLD) {
    console.error('FAILED: Score below threshold');
    process.exit(1);
  }

  console.log('PASSED');
  process.exit(0);
}

main();
