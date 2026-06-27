import {z} from 'zod';
import {createTool} from '../create-tool.js';

export const echoTool = createTool({
  name: 'echo',
  description: 'Echo back the input. Useful for testing the tool execution pipeline.',
  inputSchema: z.object({
    message: z.string().describe('Message to echo'),
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
