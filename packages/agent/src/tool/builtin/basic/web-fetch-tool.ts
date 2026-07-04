// src/tool/builtin/web-fetch-tool.ts
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';

const webFetchParams = z.object({
  url: z.string().describe('要请求的 URL（仅支持 http/https）'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET').describe('HTTP 方法'),
  headers: z.record(z.string(), z.string()).optional().describe('自定义请求头'),
  body: z.string().optional().describe('请求体（POST/PUT/PATCH 时使用）'),
  timeout: z.number().min(1000).max(60000).default(15000).describe('超时时间（毫秒）'),
});

const MAX_RESPONSE_SIZE = 100 * 1024; // 100KB

const webFetchOutput = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
});

async function executeWebFetch(args: z.infer<typeof webFetchParams>, _ctx: ToolCallContext) {
  // 仅允许 http/https
  if (!/^https?:\/\//i.test(args.url)) {
    return { status: 0, statusText: 'Invalid URL', headers: {}, body: '', error: '仅支持 http/https URL' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeout);

  try {
    const response = await fetch(args.url, {
      method: args.method,
      headers: {
        'User-Agent': 'Vico-Agent/1.0',
        'Accept': 'text/html,application/json,text/plain,*/*',
        ...args.headers,
      },
      body: args.body || undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const truncated = text.length > MAX_RESPONSE_SIZE;
    const body = truncated ? text.slice(0, MAX_RESPONSE_SIZE) + '\n... (响应已截断)' : text;

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      truncated,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { status: 0, statusText: 'Timeout', headers: {}, body: '', error: `请求超时 (${args.timeout}ms)` };
    }
    return { status: 0, statusText: 'Error', headers: {}, body: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export const webFetchTool = createTool({
  name: 'web_fetch',
  description:
    '发起 HTTP 请求获取网页或 API 数据。支持自定义方法、请求头和请求体。响应体超过 100KB 自动截断。用于查阅在线文档、调用 API 等场景。',
  inputSchema: webFetchParams,
  outputSchema: webFetchOutput,
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'network'],
  execute: executeWebFetch,
});
