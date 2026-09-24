// src/tool/builtin/basic/ask-user-tool.ts
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';

const askUserParams = z.object({
  question: z.string().describe('需要向用户澄清的问题'),
  options: z.array(z.string()).optional().describe('可选的候选项，用户可从中选择或自由输入'),
});

const askUserOutput = z.object({
  answer: z.string().describe('用户的回答'),
});

/**
 * 向用户提问。
 *
 * policy 为 on-request：首次调用即触发审批暂停，用户提交的文本回答由引擎
 * 在 resume 时注入为工具结果（见 loop-agent.loadCheckpoint 的 answer 注入），
 * 因此本 execute 正常不会被调用，仅作为「用户批准但未提供回答」时的兜底。
 */
async function executeAskUser(_args: z.infer<typeof askUserParams>, _ctx: ToolCallContext) {
  return { answer: '' };
}

export const askUserTool = createTool({
  name: 'ask_user',
  description:
    '当需要向用户澄清问题、请求补充信息或让用户做出选择时使用。提交 question（问题）和可选的 options（候选项），等待用户回答后继续执行。',
  inputSchema: askUserParams,
  outputSchema: askUserOutput,
  policy: 'on-request',
  kind: 'mutation',
  tags: ['builtin', 'human-in-the-loop'],
  execute: executeAskUser,
});
