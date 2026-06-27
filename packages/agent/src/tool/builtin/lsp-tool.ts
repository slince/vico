// src/tool/builtin/lsp-tool.ts
import {z} from 'zod';
import {createTool} from '../create-tool.js';

const lspParams = z.object({
  action: z.enum(['diagnostics', 'go_to_definition', 'completions', 'hover']).describe('LSP action to perform'),
  filePath: z.string().describe('File path for the LSP request'),
  line: z.number().int().min(1).optional().describe('Line number (1-based)'),
  column: z.number().int().min(1).optional().describe('Column number (1-based)'),
});

export const lspTool = createTool({
  name: 'lsp',
  description:
    'Language Server Protocol support: request diagnostics, go-to-definition, and code completions. Requires a configured LSP server for the target language.',
  inputSchema: lspParams,
  outputSchema: z.object({
    supported: z.boolean(),
    message: z.string(),
  }),
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read', 'optional'],
  async execute() {
    return {
      supported: false,
      message: 'LSP support is not yet configured. To enable LSP, install the appropriate language server for your project and configure it in the Vico settings. Supported actions: diagnostics, go_to_definition, completions, hover.',
    };
  },
});
