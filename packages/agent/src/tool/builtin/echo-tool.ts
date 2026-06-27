import {createTool} from '../create-tool.js';

export const echoTool = createTool({
  name: 'echo',
  description: 'Echo back the input. Useful for testing the tool execution pipeline.',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', description: 'Message to echo' } },
    required: ['message'],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  async execute(call) {
    return (call.args as { message: string }).message ?? '';
  },
});
