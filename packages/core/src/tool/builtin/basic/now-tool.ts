import {z} from 'zod';
import {createTool} from '../../create-tool.js';

export const nowTool = createTool({
  name: 'now',
  description: '获取当前日期和时间（ISO 8601 格式）。',
  inputSchema: z.object({}),
  outputSchema: z.object({
    datetime: z.string().describe('ISO 8601 格式的当前日期和时间'),
  }),
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  execute: async () => ({ datetime: new Date().toISOString() }),
});
