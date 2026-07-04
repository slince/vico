// src/tool/builtin/lsp-tool.ts
import {ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

/** 语言 → LSP 服务器命令映射 */
const LSP_SERVERS: Record<string, { cmd: string; args: string[] }> = {
  typescript: { cmd: 'typescript-language-server', args: ['--stdio'] },
  javascript: { cmd: 'typescript-language-server', args: ['--stdio'] },
  python: { cmd: 'pyright-langserver', args: ['--stdio'] },
  go: { cmd: 'gopls', args: [] },
  rust: { cmd: 'rust-analyzer', args: [] },
};

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
};

interface LspSession {
  process: ChildProcess;
  buffer: string;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  idCounter: number;
  initialized: boolean;
  fileUri: string;
}

const sessions = new Map<string, LspSession>();

function getLang(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXT_TO_LANG[ext] || '';
}

function sendRequest(session: LspSession, method: string, params: unknown): Promise<unknown> {
  const id = ++session.idCounter;
  const request = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    try {
      session.process.stdin!.write(`Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`);
    } catch (err: any) {
      session.pending.delete(id);
      reject(err);
    }
    setTimeout(() => {
      if (session.pending.has(id)) {
        session.pending.delete(id);
        reject(new Error(`LSP request ${method} timed out`));
      }
    }, 15000);
  });
}

function sendNotification(session: LspSession, method: string, params: unknown): void {
  const notification = JSON.stringify({ jsonrpc: '2.0', method, params });
  try {
    session.process.stdin!.write(`Content-Length: ${Buffer.byteLength(notification)}\r\n\r\n${notification}`);
  } catch { /* ignore */ }
}

function handleLspMessage(session: LspSession, data: string) {
  session.buffer += data;
  while (true) {
    const headerEnd = session.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = session.buffer.slice(0, headerEnd);
    const m = header.match(/Content-Length: (\d+)/);
    if (!m) { session.buffer = ''; break; }
    const contentLength = parseInt(m[1]);
    const msgStart = headerEnd + 4;
    if (session.buffer.length < msgStart + contentLength) break;
    const body = session.buffer.slice(msgStart, msgStart + contentLength);
    session.buffer = session.buffer.slice(msgStart + contentLength);
    try {
      const msg = JSON.parse(body);
      if (msg.id && session.pending.has(msg.id)) {
        const { resolve, reject } = session.pending.get(msg.id)!;
        session.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'LSP error'));
        else resolve(msg.result);
      }
    } catch { /* ignore */ }
  }
}

function startLspSession(workspace: string, filePath: string): { session: LspSession; error?: string } {
  const lang = getLang(filePath);
  if (!lang) return { session: null!, error: `不支持的文件类型: ${filePath}。支持: ${Object.keys(EXT_TO_LANG).join(', ')}` };

  const lspConfig = LSP_SERVERS[lang];
  if (!lspConfig) return { session: null!, error: `未配置 ${lang} 的语言服务器` };

  const key = `${workspace}:${lang}`;
  const existing = sessions.get(key);
  if (existing) return { session: existing };

  try {
    const proc = spawn(lspConfig.cmd, lspConfig.args, {
      cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: LspSession = {
      process: proc,
      buffer: '',
      pending: new Map(),
      idCounter: 0,
      initialized: false,
      fileUri: `file://${filePath}`,
    };

    proc.stdout!.on('data', (chunk: Buffer) => handleLspMessage(session, chunk.toString()));
    proc.stderr!.on('data', () => { /* ignore */ });
    proc.on('error', () => sessions.delete(key));
    proc.on('close', () => sessions.delete(key));

    sessions.set(key, session);
    return { session };
  } catch (err: any) {
    return { session: null!, error: `启动 LSP 失败: ${err.message}` };
  }
}

async function initSession(session: LspSession, workspace: string, filePath: string) {
  if (session.initialized) {
    if (session.fileUri !== `file://${filePath}`) {
      sendNotification(session, 'textDocument/didOpen', {
        textDocument: { uri: `file://${filePath}`, languageId: getLang(filePath), version: 1, text: '' },
      });
      session.fileUri = `file://${filePath}`;
    }
    return;
  }

  await sendRequest(session, 'initialize', {
    processId: process.pid,
    rootUri: `file://${workspace}`,
    capabilities: {
      textDocument: {
        diagnostic: { dynamicRegistration: true },
        definition: { dynamicRegistration: true },
        completion: { dynamicRegistration: true },
        hover: { dynamicRegistration: true },
      },
    },
  });
  sendNotification(session, 'initialized', {});
  sendNotification(session, 'textDocument/didOpen', {
    textDocument: { uri: `file://${filePath}`, languageId: getLang(filePath), version: 1, text: '' },
  });
  session.initialized = true;
  session.fileUri = `file://${filePath}`;
}

const lspParams = z.object({
  action: z.enum(['diagnostics', 'go_to_definition', 'completions', 'hover']).describe('LSP 操作类型'),
  filePath: z.string().describe('目标文件路径'),
  line: z.number().int().min(1).optional().describe('行号'),
  column: z.number().int().min(1).optional().describe('列号'),
});

const lspOutput = z.object({
  result: z.string(),
  action: z.string(),
  supported: z.boolean(),
  error: z.string().optional(),
});

async function executeLsp(args: z.infer<typeof lspParams>, ctx: ToolCallContext) {
  const absPath = resolveWorkspacePath(ctx.session.workspace, args.filePath);
  if (!existsSync(absPath)) {
    return { result: '', action: args.action, supported: false, error: `文件不存在` };
  }

  const { session, error } = startLspSession(ctx.session.workspace, absPath);
  if (error) return { result: '', action: args.action, supported: false, error };

  try {
    await initSession(session, ctx.session.workspace, absPath);
  } catch (err: any) {
    return { result: '', action: args.action, supported: true, error: `LSP 初始化失败: ${err.message}` };
  }

  const line = args.line ?? 0;
  const column = args.column ?? 0;

  try {
    switch (args.action) {
      case 'diagnostics': {
        const r = await sendRequest(session, 'textDocument/diagnostic', {
          textDocument: { uri: session.fileUri },
        });
        const items = (r as any)?.items || [];
        if (items.length === 0) return { result: '无诊断问题', action: args.action, supported: true };
        const out = items.map((item: any) =>
          `[${item.severity === 1 ? 'ERROR' : 'WARNING'}] L${item.range.start.line + 1}:${item.range.start.character + 1}: ${item.message}`,
        ).join('\n');
        return { result: out, action: args.action, supported: true };
      }
      case 'go_to_definition': {
        const r = await sendRequest(session, 'textDocument/definition', {
          textDocument: { uri: session.fileUri },
          position: { line: line - 1, character: column - 1 },
        });
        const locs = (Array.isArray(r) ? r : [r]).filter(Boolean);
        const out = locs.map((loc: any) =>
          `${loc.uri.replace('file://', '')}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`,
        ).join('\n');
        return { result: out || '未找到定义', action: args.action, supported: true };
      }
      case 'completions': {
        const r = await sendRequest(session, 'textDocument/completion', {
          textDocument: { uri: session.fileUri },
          position: { line: line - 1, character: column - 1 },
        });
        const items = (r as any)?.items || (r as any) || [];
        const out = items.slice(0, 20).map((item: any) =>
          `${item.label} — ${item.detail || ''}`,
        ).join('\n');
        return { result: out || '无补全建议', action: args.action, supported: true };
      }
      case 'hover': {
        const r = await sendRequest(session, 'textDocument/hover', {
          textDocument: { uri: session.fileUri },
          position: { line: line - 1, character: column - 1 },
        });
        const contents = (r as any)?.contents;
        if (!contents) return { result: '无悬停信息', action: args.action, supported: true };
        const text = typeof contents === 'string' ? contents :
          Array.isArray(contents) ? contents.map((c: any) => c.value || c).join('\n') :
          contents.value || JSON.stringify(contents);
        return { result: text, action: args.action, supported: true };
      }
      default:
        return { result: '', action: args.action, supported: true, error: 'Unknown action' };
    }
  } catch (err: any) {
    return { result: '', action: args.action, supported: true, error: err.message };
  }
}

export const lspTool = createTool({
  name: 'lsp',
  description:
    '语言服务器协议集成工具。支持诊断（diagnostics）、跳转定义（go_to_definition）、代码补全（completions）和悬停信息（hover）。自动按文件扩展名匹配语言服务器，需在系统中安装对应的 LSP（typescript-language-server/pyright/gopls/rust-analyzer）。',
  inputSchema: lspParams,
  outputSchema: lspOutput,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeLsp,
});
