// src/tool/builtin/lsp-tool.ts
import {createTool} from '../create-tool.js';

/**
 * LSP 工具 — 语言服务器协议支持（可选）。
 *
 * 当前为占位实现。完整 LSP 支持需要：
 * 1. 安装对应语言的 LSP 服务器（如 typescript-language-server、pyright）
 * 2. 通过 vscode-languageserver / lsp 协议与服务器通信
 * 3. 提供诊断（diagnostics）、跳转定义（go-to-definition）、补全（completions）等功能
 *
 * 此工具在 LSP 未配置时返回提示信息。
 */
export const lspTool = createTool({
  name: 'lsp',
  description:
    'Language Server Protocol support: request diagnostics, go-to-definition, and code completions. Requires a configured LSP server for the target language.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['diagnostics', 'go_to_definition', 'completions', 'hover'],
        description: 'LSP action to perform',
      },
      filePath: { type: 'string', description: 'File path for the LSP request' },
      line: { type: 'number', description: 'Line number (1-based, for hover/definition/completions)' },
      column: { type: 'number', description: 'Column number (1-based, for hover/definition/completions)' },
    },
    required: ['action', 'filePath'],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read', 'optional'],
  async execute(_call, _ctx) {
    return 'LSP support is not yet configured. To enable LSP, install the appropriate language server for your project and configure it in the Vico settings. Supported actions: diagnostics, go_to_definition, completions, hover.';
  },
});
