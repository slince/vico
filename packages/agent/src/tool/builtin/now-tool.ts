import {z} from 'zod';
import {createTool} from '../create-tool.js';

export const nowTool = createTool({
  name: 'now',
  description: 'Get the current date and time in ISO 8601 format.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    datetime: z.string().describe('ISO 8601 formatted current date and time'),
  }),
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  execute: async () => ({ datetime: new Date().toISOString() }),
});
