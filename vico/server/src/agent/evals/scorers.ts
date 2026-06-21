/**
 * Eval Scorer — 自定义 LLM 评分实现（不再依赖 @mastra/evals）。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScorerFn = (args: {
  input: string;
  output: string;
  context?: string[];
  referenceAnswer?: string;
  expectedTools?: string[];
  actualTools?: string[];
}) => Promise<{ score: number; reason: string }>;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

let scorerModel: LanguageModel = createOpenAI().chat('gpt-4o-mini') as unknown as LanguageModel;

export function setScorerModel(model: LanguageModel): void {
  scorerModel = model;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const scorerRegistry: Record<string, ScorerFn> = {};

export function registerScorer(name: string, fn: ScorerFn): void {
  scorerRegistry[name] = fn;
}

export function getScorer(name: string): ScorerFn | undefined {
  return scorerRegistry[name];
}

export function listScorers(): string[] {
  return Object.keys(scorerRegistry);
}

// ---------------------------------------------------------------------------
// Built-in scorers
// ---------------------------------------------------------------------------

registerScorer('answer-relevancy', async ({ input, output }) => {
  const { text } = await generateText({
    model: scorerModel,
    prompt: `评估以下回答与问题的相关度。只返回一个 0-1 之间的分数。
问题: ${input}
回答: ${output}
分数 (0-1):`,
  });
  const score = parseFloat(text.trim()) || 0;
  return { score, reason: text.trim() };
});

registerScorer('faithfulness', async ({ input, output }) => {
  const { text } = await generateText({
    model: scorerModel,
    prompt: `评估以下回答是否忠实于输入的问题。检查回答是否基于问题上下文，不生编乱造。只返回 0-1 之间的分数。
问题: ${input}
回答: ${output}
分数 (0-1):`,
  });
  const score = parseFloat(text.trim()) || 0;
  return { score, reason: text.trim() };
});

registerScorer('hallucination', async ({ input, output, context }) => {
  const ctx = context?.length ? `\n参考上下文:\n${context.join('\n')}` : '';
  const { text } = await generateText({
    model: scorerModel,
    prompt: `评估以下回答是否包含幻觉（虚构的信息）。只返回 0-1 之间的分数（1=没有幻觉）。
问题: ${input}${ctx}
回答: ${output}
分数 (0-1):`,
  });
  const score = parseFloat(text.trim()) || 0;
  return { score, reason: text.trim() };
});

registerScorer('tool-call-accuracy', async ({ expectedTools, actualTools }) => {
  if (!expectedTools?.length && !actualTools?.length) return { score: 1, reason: 'No tools expected or used' };
  if (!expectedTools?.length) return { score: actualTools?.length ? 0 : 1, reason: 'Unexpected tools called' };
  if (!actualTools?.length) return { score: 0, reason: 'Expected tools not called' };
  const matched = expectedTools.filter(t => actualTools.includes(t)).length;
  const score = matched / Math.max(expectedTools.length, actualTools.length);
  return { score, reason: `Matched ${matched}/${expectedTools.length} expected tools` };
});
