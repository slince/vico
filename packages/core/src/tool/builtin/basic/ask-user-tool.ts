// src/tool/builtin/basic/ask-user-tool.ts
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';

/** 结构化候选项：label + 可选描述 */
const askUserOptionSchema = z.object({
  label: z.string().describe('用户可见的候选项标签'),
  description: z.string().optional().describe('一句话说明该选项的影响或权衡'),
});

/** 单个待回答的问题 */
const askUserQuestionSchema = z.object({
  id: z.string().describe('问题的稳定标识，答案回传时原样返回'),
  question: z.string().describe('需要向用户澄清的具体问题'),
  header: z.string().optional().describe('可选的简短标题，如「确认」或「选择模式」'),
  detail: z.string().optional().describe('随问题展示的补充说明，不进入候选项标签'),
  options: z.array(askUserOptionSchema).optional().describe('可选的候选项；推荐项放首位并在 label 后追加「(推荐)」'),
  multiSelect: z.boolean().optional().describe('是否允许多选；缺省为单选'),
});

const askUserParams = z.object({
  questions: z.array(askUserQuestionSchema).describe('需要向用户提问的问题列表'),
});

/** 单个问题的回答 */
const askUserAnswerSchema = z.object({
  id: z.string().describe('对应的问题 id'),
  selected: z.array(z.string()).describe('选中的候选项 label；单选 0/1 个，多选 0..n 个'),
  custom: z.string().optional().describe('自由文本回答；单选时覆盖 selected，多选时补充 selected'),
});

/** ask_user 输出：用户对每个问题的结构化回答 */
export const askUserOutputSchema = z.object({
  answers: z.array(askUserAnswerSchema).describe('用户对每个问题的回答'),
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
    return { ok: false, error: 'INVALID_ANSWER: 回答不是合法 JSON' };
  }
  const result = askUserOutputSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `INVALID_ANSWER: 回答校验失败：${result.error.message}` };
  }
  if (result.data.answers.length === 0) {
    return { ok: false, error: 'EMPTY_ANSWER: 未提供任何回答' };
  }
  return { ok: true, answers: result.data.answers };
}

/**
 * 向用户提问。
 *
 * policy 为 on-request：首次调用即触发审批暂停，resume 时引擎把该 call 对应的
 * ToolCallApproval（含用户在 reason 里提交的 JSON 回答）注入到 ctx.approval，
 * 本 execute 从 ctx.approval.answer 读取并解析为结构化答案返回。
 */
async function executeAskUser(_args: z.infer<typeof askUserParams>, ctx: ToolCallContext) {
  const answer = ctx.approval?.answer;
  if (answer === undefined) {
    throw new Error('EMPTY_ANSWER: 用户批准但未提供回答');
  }
  const parsed = parseAskUserAnswers(answer);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return { answers: parsed.answers };
}

export const askUserTool = createTool({
  name: 'ask_user',
  description:
    '当需要向用户澄清问题、请求补充信息或让用户做出选择时使用。提交 questions（问题列表，可一次问多个），每个问题含 id、question，可选 header、detail、options（候选项 label+description）、multiSelect（是否多选）。等待用户回答后继续执行。单选时用户可自由输入（custom 覆盖所选）或从候选中选一个；多选时用户从候选中选择多个，custom 作为补充。',
  inputSchema: askUserParams,
  outputSchema: askUserOutputSchema,
  policy: 'on-request',
  kind: 'mutation',
  tags: ['builtin', 'human-in-the-loop'],
  execute: executeAskUser,
});
