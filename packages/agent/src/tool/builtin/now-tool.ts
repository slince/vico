import {createTool} from '../create-tool.js';

export const nowTool = createTool({
  name: 'now',
  description: 'Get the current date and time in ISO 8601 format.',
  inputSchema: { type: 'object', properties: {} },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  execute: async () => new Date().toISOString(),
});
