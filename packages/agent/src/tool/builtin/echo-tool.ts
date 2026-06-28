import {z} from 'zod';
import {createTool} from '../create-tool.js';

export const echoTool = createTool({
  name: 'echo',
  description: '回显输入内容，用于测试工具执行管道。',
  inputSchema: z.object({
    message: z.string().describe('要回显的消息'),
  }),
  outputSchema: z.object({
    message: z.string(),
  }),
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  async execute(call) {
    const { message } = call.args as { message: string };
    return { message };
  },
});
