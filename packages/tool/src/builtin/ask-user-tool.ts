// src/tool/builtin/ask-user-tool.ts
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCallContext} from '../types.js';

/** 结构化候选项：label + 可选描述 */
const askUserOptionSchema = z.object({
  label: z.string().describe('User-visible label for the option'),
  description: z.string().optional().describe('One-line note on the option’s impact or trade-offs'),
});

/** 单个待回答的问题 */
const askUserQuestionSchema = z.object({
  id: z.string().describe('Stable identifier for the question, returned unchanged with the answer'),
  question: z.string().describe('The specific question to clarify with the user'),
  header: z.string().optional().describe('Optional short header, e.g. "Confirm" or "Choose mode"'),
  detail: z.string().optional().describe('Supplementary detail shown with the question, not used as an option label'),
  options: z.array(askUserOptionSchema).optional().describe('Optional choices; put the recommended one first and append "(Recommended)" to its label'),
  multiSelect: z.boolean().optional().describe('Whether multiple selections are allowed; defaults to single-select'),
});

const askUserParams = z.object({
  questions: z.array(askUserQuestionSchema).describe('List of questions to ask the user'),
});

/** 单个问题的回答 */
const askUserAnswerSchema = z.object({
  id: z.string().describe('The id of the corresponding question'),
  selected: z.array(z.string()).describe('Selected option labels; 0/1 for single-select, 0..n for multi-select'),
  custom: z.string().optional().describe('Free-text answer; overrides selected for single-select, supplements selected for multi-select'),
});

/** ask_user 输出：用户对每个问题的结构化回答 */
export const askUserOutputSchema = z.object({
  answers: z.array(askUserAnswerSchema).describe('The user’s answer to each question'),
});

export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;
export type AskUserOutput = z.infer<typeof askUserOutputSchema>;

/**
 * 解析审批 reason 承载的用户回答为结构化答案。
 *
 * 前端约定 reason 为 JSON 对象 `{"answers":[{"id","selected":[...],"custom"?}]}`。
 * 解析失败或校验不过时返回 error（带错误码），由引擎注入 tool-error 而非静默回退。
 *
 * @param raw - tool-approval-response 的 reason 原文
 * @returns 解析成功返回答案列表，失败返回错误描述
 */
export function parseAskUserAnswers(
  raw: string,
): { ok: true; answers: AskUserAnswer[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'INVALID_ANSWER: answer is not valid JSON' };
  }
  const result = askUserOutputSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `INVALID_ANSWER: answer validation failed: ${result.error.message}` };
  }
  if (result.data.answers.length === 0) {
    return { ok: false, error: 'EMPTY_ANSWER: no answers provided' };
  }
  return { ok: true, answers: result.data.answers };
}

/**
 * 向用户提问。
 *
 * policy 为 always：首次调用即触发审批暂停，resume 时引擎把该 call 对应的
 * ToolCallApproval（含用户在 reason 里提交的 JSON 回答）注入到 ctx.approval，
 * 本 execute 从 ctx.approval.reason 读取并解析为结构化答案返回。
 */
async function executeAskUser(_args: z.infer<typeof askUserParams>, ctx: ToolCallContext) {
  const reason = ctx.approval?.reason;
  if (reason === undefined) {
    throw new Error('EMPTY_ANSWER: approved but no answer provided');
  }
  const parsed = parseAskUserAnswers(reason);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return { answers: parsed.answers };
}

export const askUserTool = createTool({
  name: 'ask_user',
  description:
    'Use when you need to ask the user to clarify, provide more information, or make a choice. Submit questions (a list, so you can ask several at once); each question has id and question, plus optional header, detail, options (choice label + description), and multiSelect. Wait for the user’s answer before continuing. For single-select the user can type freely (custom overrides the selection) or pick one option; for multi-select the user picks several options and custom supplements them.',
  inputSchema: askUserParams,
  outputSchema: askUserOutputSchema,
  policy: 'always',
  kind: 'readonly',
  execute: executeAskUser,
});
