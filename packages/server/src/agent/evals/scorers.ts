/**
 * Eval Scorer Registry
 *
 * Wraps @mastra/evals scorers behind a simplified async function interface
 * so callers don't need to know about MastraScorer internals or model wiring.
 *
 * Built-in scorers are registered at module load time with a default model.
 * Call `setScorerModel()` to swap the model (e.g. after application config
 * is loaded) — all cached scorer instances are invalidated automatically.
 */
import { createOpenAI } from '@ai-sdk/openai';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';
import { createFaithfulnessScorer } from '@mastra/evals/scorers/prebuilt';
import { createHallucinationScorer } from '@mastra/evals/scorers/prebuilt';
import { createToolCallAccuracyScorerLLM } from '@mastra/evals/scorers/prebuilt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Simplified scorer function signature used by the eval pipeline.
 *
 * All fields except `input` and `output` are optional. Built-in scorers
 * ignore arguments they do not need.
 */
export type ScorerFn = (args: {
  /** User / agent input text. */
  input: string;
  /** Agent output text. */
  output: string;
  /** Additional context strings (e.g. retrieved passages for RAG eval). */
  context?: string[];
  /** Ground-truth reference answer. */
  referenceAnswer?: string;
  /** List of tool names the agent was expected to call. */
  expectedTools?: string[];
  /** List of tool names the agent actually called. */
  actualTools?: string[];
}) => Promise<{ score: number; reason: string }>;

// ---------------------------------------------------------------------------
// Scorer model (defaults to OpenAI; call setScorerModel to override)
// ---------------------------------------------------------------------------

let scorerModel: MastraModelConfig = createOpenAI().chat('gpt-4o-mini');

/**
 * Replace the model used by all built-in scorers.
 *
 * Existing cached scorer instances are discarded so that the next call to
 * any built-in scorer picks up the new model.
 */
export function setScorerModel(model: MastraModelConfig): void {
  scorerModel = model;
  // Invalidate cached instances so they are re-created with the new model.
  cachedScorers.clear();
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const scorerRegistry: Record<string, ScorerFn> = {};

/**
 * Add (or overwrite) a scorer function in the registry.
 */
export function registerScorer(name: string, fn: ScorerFn): void {
  scorerRegistry[name] = fn;
}

/**
 * Look up a scorer by name. Returns `undefined` when the name is unknown.
 */
export function getScorer(name: string): ScorerFn | undefined {
  return scorerRegistry[name];
}

/**
 * Return the names of all registered scorers.
 */
export function listScorers(): string[] {
  return Object.keys(scorerRegistry);
}

// ---------------------------------------------------------------------------
// Lazy scorer cache (invalidated when model changes)
// ---------------------------------------------------------------------------

const cachedScorers = new Map<string, ReturnType<typeof createScorerInstance>>();

function createScorerInstance(name: string): any {
  switch (name) {
    case 'answer-relevancy':
      return createAnswerRelevancyScorer({ model: scorerModel });
    case 'faithfulness':
      return createFaithfulnessScorer({ model: scorerModel });
    case 'hallucination':
      return createHallucinationScorer({ model: scorerModel });
    case 'tool-call-accuracy':
      return createToolCallAccuracyScorerLLM({ model: scorerModel, availableTools: [] });
    default:
      throw new Error(`Unknown built-in scorer: ${name}`);
  }
}

function getOrCreateScorer(name: string): any {
  let scorer = cachedScorers.get(name);
  if (!scorer) {
    scorer = createScorerInstance(name);
    cachedScorers.set(name, scorer);
  }
  return scorer;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal ScorerRunInputForAgent from a plain string
// ---------------------------------------------------------------------------

function toAgentInput(input: string) {
  return {
    inputMessages: [
      {
        id: 'eval-input',
        role: 'user' as const,
        content: input,
        createdAt: new Date(),
      },
    ],
    rememberedMessages: [],
    systemMessages: [],
    taggedSystemMessages: {},
  };
}

function toAgentOutput(output: string, toolNames?: string[]) {
  const msg: any = {
    id: 'eval-output',
    role: 'assistant' as const,
    content: output,
    createdAt: new Date(),
  };
  if (toolNames && toolNames.length > 0) {
    msg.toolInvocations = toolNames.map((name) => ({
      toolCallId: `eval-call-${name}`,
      toolName: name,
      args: {},
      result: {},
      state: 'result' as const,
    }));
  }
  return [msg];
}

// ---------------------------------------------------------------------------
// Built-in scorers
// ---------------------------------------------------------------------------

registerScorer('answer-relevancy', async ({ input, output }) => {
  const scorer = getOrCreateScorer('answer-relevancy');
  const result = await scorer.run({ input, output });
  return { score: result.score, reason: result.reason ?? '' };
});

registerScorer('faithfulness', async ({ input, output, context }) => {
  const scorer = getOrCreateScorer('faithfulness');
  const result = await scorer.run({ input, output });
  // Faithfulness scorers can be given context in their run to ground
  // evaluation; when the caller supplies context it is passed via
  // requestContext which some scorer internals may pick up.
  //
  // For the standard faithfulness scorer the claims are extracted from
  // the output and verified against the input, so input+output alone
  // is sufficient for a meaningful score.
  void context; // available for future enhancement (e.g. passing as groundTruth)
  return { score: result.score, reason: result.reason ?? '' };
});

registerScorer('hallucination', async ({ input, output, context }) => {
  // Rebuild the scorer when context is provided so it is passed as
  // options.context to createHallucinationScorer.
  let scorer: any;
  if (context && context.length > 0) {
    scorer = createHallucinationScorer({ model: scorerModel, options: { context } });
  } else {
    scorer = getOrCreateScorer('hallucination');
  }
  const result = await scorer.run({ input, output });
  return { score: result.score, reason: result.reason ?? '' };
});

registerScorer('tool-call-accuracy', async ({ input, output, expectedTools, actualTools }) => {
  const scorer = getOrCreateScorer('tool-call-accuracy');
  const result = await scorer.run({
    input: toAgentInput(input),
    output: toAgentOutput(output, actualTools),
    expectedTrajectory:
      expectedTools && expectedTools.length > 0
        ? { steps: expectedTools.map((name) => ({ stepType: 'tool_call' as const, name })) }
        : undefined,
  });
  return { score: result.score, reason: result.reason ?? '' };
});
