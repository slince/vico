/**
 * 浏览器工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/basic/browser-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * navigate/click 为 on-request（需审批），snapshot 为 auto（只读）。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {BrowserToolRenderer} from './ToolUIs/browser-ui';

// ── browser_navigate ──
const browserNavigateSchema = z.object({
  url: z.string().describe('要导航到的 URL（需以 http/https 开头）'),
});
const browserNavigateOutputSchema = z.object({
  title: z.string(),
  url: z.string(),
  ready: z.boolean(),
  error: z.string().optional(),
});
export type BrowserNavigateArgs = z.infer<typeof browserNavigateSchema>;
export type BrowserNavigateResult = z.infer<typeof browserNavigateOutputSchema>;

// ── browser_snapshot ──
const browserSnapshotSchema = z.object({
  url: z.string().describe('要截取快照的 URL'),
});
const browserSnapshotOutputSchema = z.object({
  text: z.string(),
  url: z.string(),
  error: z.string().optional(),
});
export type BrowserSnapshotArgs = z.infer<typeof browserSnapshotSchema>;
export type BrowserSnapshotResult = z.infer<typeof browserSnapshotOutputSchema>;

// ── browser_click ──
const browserClickSchema = z.object({
  url: z.string().describe('当前页面 URL'),
  selector: z.string().describe('点击目标的 CSS 选择器'),
  text: z.string().optional().describe('点击包含此文本的元素（selector 优先级更高）'),
});
const browserClickOutputSchema = z.object({
  title: z.string(),
  url: z.string(),
  clicked: z.boolean(),
  error: z.string().optional(),
});
export type BrowserClickArgs = z.infer<typeof browserClickSchema>;
export type BrowserClickResult = z.infer<typeof browserClickOutputSchema>;

export const browserNavigateTool: ToolkitDefinitionEntry<BrowserNavigateArgs, BrowserNavigateResult> = {
  description: '使用 headless Chromium 导航到指定 URL，返回页面标题和最终 URL。需要安装 Playwright 依赖。',
  parameters: browserNavigateSchema,
  render: BrowserToolRenderer,
};

export const browserSnapshotTool: ToolkitDefinitionEntry<BrowserSnapshotArgs, BrowserSnapshotResult> = {
  description: '获取页面的文本快照（可见文本内容），不包含 HTML 标签。需安装 Playwright。',
  parameters: browserSnapshotSchema,
  render: BrowserToolRenderer,
};

export const browserClickTool: ToolkitDefinitionEntry<BrowserClickArgs, BrowserClickResult> = {
  description: '点击页面元素（CSS 选择器或文本匹配），等待导航后返回新页面信息。需安装 Playwright。',
  parameters: browserClickSchema,
  render: BrowserToolRenderer,
};
