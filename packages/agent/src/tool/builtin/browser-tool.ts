// src/tool/builtin/browser-tool.ts
//
// 基于 Playwright 的浏览器工具。Playwright 为可选 peer dependency，
// 未安装时工具返回明确的安装提示。
import { z } from 'zod';
import { createTool } from '../create-tool.js';
import type { ToolExecutionContext } from '../types.js';

/** 懒加载 Playwright（避免编译时模块解析错误） */
async function loadPlaywright(): Promise<any> {
  // 使用 new Function 包装动态 import，避免 TypeScript 编译时解析
  return new Function('return import("playwright")')();
}

let playwrightAvailable = false;
let playwrightError = '';

async function checkPlaywright() {
  if (playwrightAvailable) return true;
  try {
    await loadPlaywright();
    playwrightAvailable = true;
    return true;
  } catch (err: any) {
    playwrightError = err.message;
    return false;
  }
}

async function launchBrowser() {
  const pw = await loadPlaywright();
  return pw.chromium.launch({ headless: true });
}

// ── browser_navigate ──

const navigateParams = z.object({
  url: z.string().describe('要导航到的 URL（需以 http/https 开头）'),
});

const navigateOutput = z.object({
  title: z.string(),
  url: z.string(),
  ready: z.boolean(),
  error: z.string().optional(),
});

async function executeNavigate(args: z.infer<typeof navigateParams>, _ctx: ToolExecutionContext) {
  if (!await checkPlaywright()) {
    return { title: '', url: args.url, ready: false,
      error: `Playwright 未安装。请运行: npm install playwright && npx playwright install chromium\n详情: ${playwrightError}` };
  }
  if (!/^https?:\/\//i.test(args.url)) {
    return { title: '', url: args.url, ready: false, error: 'URL 必须以 http/https 开头' };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(args.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const title = await page.title();
    return { title, url: page.url(), ready: true };
  } finally {
    await browser.close();
  }
}

export const browserNavigateTool = createTool({
  name: 'browser_navigate',
  description: '使用 headless Chromium 导航到指定 URL，返回页面标题和最终 URL。需要安装 Playwright 依赖。',
  inputSchema: navigateParams,
  outputSchema: navigateOutput,
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'browser'],
  execute: executeNavigate,
});

// ── browser_snapshot ──

const snapshotParams = z.object({
  url: z.string().describe('要截取快照的 URL'),
});

const snapshotOutput = z.object({
  text: z.string(),
  url: z.string(),
  error: z.string().optional(),
});

async function executeSnapshot(args: z.infer<typeof snapshotParams>, _ctx: ToolExecutionContext) {
  if (!await checkPlaywright()) {
    return { text: '', url: args.url,
      error: 'Playwright 未安装。请运行: npm install playwright && npx playwright install chromium' };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(args.url, { timeout: 30000, waitUntil: 'domcontentloaded' });

    const text = await page.evaluate(() => {
      document.querySelectorAll('script, style, noscript').forEach((e) => e.remove());
      return document.body?.innerText?.slice(0, 20000) || '(空页面)';
    });

    return { text, url: page.url() };
  } finally {
    await browser.close();
  }
}

export const browserSnapshotTool = createTool({
  name: 'browser_snapshot',
  description: '获取页面的文本快照（可见文本内容）。用于提取网页信息，不包含 HTML 标签。需安装 Playwright。',
  inputSchema: snapshotParams,
  outputSchema: snapshotOutput,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'browser', 'read'],
  execute: executeSnapshot,
});

// ── browser_click ──

const clickParams = z.object({
  url: z.string().describe('当前页面 URL'),
  selector: z.string().describe('点击目标的 CSS 选择器'),
  text: z.string().optional().describe('点击包含此文本的元素（selector 优先级更高）'),
});

const clickOutput = z.object({
  title: z.string(),
  url: z.string(),
  clicked: z.boolean(),
  error: z.string().optional(),
});

async function executeClick(args: z.infer<typeof clickParams>, _ctx: ToolExecutionContext) {
  if (!await checkPlaywright()) {
    return { title: '', url: args.url, clicked: false,
      error: 'Playwright 未安装。请运行: npm install playwright && npx playwright install chromium' };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(args.url, { timeout: 30000, waitUntil: 'domcontentloaded' });

    if (args.selector) {
      await page.click(args.selector, { timeout: 10000 });
    } else if (args.text) {
      await page.click(`text=${args.text}`, { timeout: 10000 });
    } else {
      return { title: '', url: page.url(), clicked: false, error: '请提供 selector 或 text' };
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

    return { title: await page.title(), url: page.url(), clicked: true };
  } finally {
    await browser.close();
  }
}

export const browserClickTool = createTool({
  name: 'browser_click',
  description: '点击页面元素（通过 CSS 选择器或文本匹配），等待可能的导航后返回新页面信息。需安装 Playwright。',
  inputSchema: clickParams,
  outputSchema: clickOutput,
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'browser'],
  execute: executeClick,
});
