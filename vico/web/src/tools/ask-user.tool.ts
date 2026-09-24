/**
 * 向用户澄清工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/basic/ask-user-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * ask_user 为 on-request（需审批）：LLM 暂停 turn 等待用户回答，
 * 用户回答随 tool-approval-response 的 reason 字段回传。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {AskUserRenderer} from './ToolUIs/ask-user-ui';

const askUserSchema = z.object({
  question: z.string().describe('需要向用户澄清的问题'),
  options: z.array(z.string()).optional().describe('可选的候选项，用户可从中选择或自由输入'),
  multiple: z.boolean().optional().describe('是否允许多选（true=多选，false/缺省=单选）；仅当提供 options 时有效'),
});
const askUserOutputSchema = z.object({
  answers: z.array(z.string()).describe('用户的回答；单选为单元素数组，多选为多元素数组'),
});
export type AskUserArgs = z.infer<typeof askUserSchema>;
export type AskUserResult = z.infer<typeof askUserOutputSchema>;

export const askUserTool: ToolkitDefinitionEntry<AskUserArgs, AskUserResult> = {
  description:
    '当需要向用户澄清问题、请求补充信息或让用户做出选择时使用。提交 question（问题）、可选的 options（候选项）和 multiple（是否多选），等待用户回答后继续执行。',
  parameters: askUserSchema,
  render: AskUserRenderer,
};
