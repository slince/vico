/**
 * 向用户澄清工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/basic/ask-user-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * ask_user 为 on-request（需审批）：LLM 暂停 turn 等待用户回答，
 * 用户回答以结构化 JSON 随 tool-approval-response 的 reason 字段回传。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {AskUserRenderer} from './ToolUIs/ask-user-ui';

const askUserOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});
const askUserQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  header: z.string().optional(),
  detail: z.string().optional(),
  options: z.array(askUserOptionSchema).optional(),
  multiSelect: z.boolean().optional(),
});
const askUserSchema = z.object({
  questions: z.array(askUserQuestionSchema),
});
const askUserAnswerSchema = z.object({
  id: z.string(),
  selected: z.array(z.string()),
  custom: z.string().optional(),
});
const askUserOutputSchema = z.object({
  answers: z.array(askUserAnswerSchema),
});
export type AskUserArgs = z.infer<typeof askUserSchema>;
export type AskUserResult = z.infer<typeof askUserOutputSchema>;

export const askUserTool: ToolkitDefinitionEntry<AskUserArgs, AskUserResult> = {
  description:
    '当需要向用户澄清问题、请求补充信息或让用户做出选择时使用。提交 questions（问题列表），等待用户回答后继续执行。',
  parameters: askUserSchema,
  render: AskUserRenderer,
};
