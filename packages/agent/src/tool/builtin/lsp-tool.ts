// src/tool/builtin/lsp-tool.ts
import {z} from 'zod';
import {createTool} from '../create-tool.js';

const lspParams = z.object({
  action: z.enum(['diagnostics', 'go_to_definition', 'completions', 'hover']).describe('要执行的 LSP 操作'),
  filePath: z.string().describe('LSP 请求的文件路径'),
  line: z.number().int().min(1).optional().describe('行号（从 1 开始）'),
  column: z.number().int().min(1).optional().describe('列号（从 1 开始）'),
});

export const lspTool = createTool({
  name: 'lsp',
  description:
    '语言服务器协议支持：请求诊断、跳转定义和代码补全。需要为目标语言配置对应的 LSP 服务器。',
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
      message: 'LSP 尚未配置。请在 Vico 配置中为目标语言安装并设置相应的语言服务器。支持的操作：diagnostics、go_to_definition、completions、hover。',
    };
  },
});
