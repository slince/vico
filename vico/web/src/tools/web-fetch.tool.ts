/**
 * Web 请求工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/basic/web-fetch-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * web_fetch 为 auto（无需审批）。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {WebFetchRenderer} from './ToolUIs/web-fetch-ui';

const webFetchSchema = z.object({
  url: z.string().describe('要请求的 URL（仅支持 http/https）'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET').describe('HTTP 方法'),
  headers: z.record(z.string(), z.string()).optional().describe('自定义请求头'),
  body: z.string().optional().describe('请求体（POST/PUT/PATCH 时使用）'),
  timeout: z.number().int().min(1000).max(60000).default(15000).describe('超时时间（毫秒）'),
});
const webFetchOutputSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
});
export type WebFetchArgs = z.infer<typeof webFetchSchema>;
export type WebFetchResult = z.infer<typeof webFetchOutputSchema>;

export const webFetchTool: ToolkitDefinitionEntry<WebFetchArgs, WebFetchResult> = {
  description: '发起 HTTP 请求获取网页或 API 数据。支持自定义方法、请求头和请求体。响应体超过 100KB 自动截断。',
  parameters: webFetchSchema,
  render: WebFetchRenderer,
};
