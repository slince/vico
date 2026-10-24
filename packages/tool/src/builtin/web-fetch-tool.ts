// src/tool/builtin/web-fetch-tool.ts
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCallContext} from '../types.js';

const webFetchParams = z.object({
  url: z.string().describe('URL to request (http/https only)'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET').describe('HTTP method'),
  headers: z.record(z.string(), z.string()).optional().describe('Custom request headers'),
  body: z.string().optional().describe('Request body (for POST/PUT/PATCH)'),
  timeout: z.number().min(1000).max(60000).default(15000).describe('Timeout in milliseconds'),
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
  // Only http/https is allowed
  if (!/^https?:\/\//i.test(args.url)) {
    return { status: 0, statusText: 'Invalid URL', headers: {}, body: '', error: 'Only http/https URLs are supported' };
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
    const body = truncated ? text.slice(0, MAX_RESPONSE_SIZE) + '\n... (response truncated)' : text;

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
      return { status: 0, statusText: 'Timeout', headers: {}, body: '', error: `Request timed out (${args.timeout}ms)` };
    }
    return { status: 0, statusText: 'Error', headers: {}, body: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export const webFetchTool = createTool({
  name: 'web_fetch',
  description:
    'Make an HTTP request to fetch web page or API data. Supports custom method, headers, and body. Response bodies over 100KB are automatically truncated. Use for reading online docs or calling APIs.',
  inputSchema: webFetchParams,
  outputSchema: webFetchOutput,
  policy: 'auto',
  kind: 'readonly',
  execute: executeWebFetch,
});
