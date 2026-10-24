// @vico/browser-tool - browser_navigate 工具：导航到指定 URL 并返回页面信息
import {z} from 'zod';
import {createTool} from '@vico/tool';
import type {ToolCallContext} from '@vico/tool';
import {checkPlaywright, launchBrowser, playwrightInstallError} from './browser-playwright.js';

const navigateParams = z.object({
  url: z.string().describe('The URL to navigate to (must start with http/https)'),
});

const navigateOutput = z.object({
  title: z.string(),
  url: z.string(),
  ready: z.boolean(),
  error: z.string().optional(),
});

async function executeNavigate(args: z.infer<typeof navigateParams>, _ctx: ToolCallContext) {
  if (!await checkPlaywright()) {
    return { title: '', url: args.url, ready: false, error: playwrightInstallError() };
  }
  if (!/^https?:\/\//i.test(args.url)) {
    return { title: '', url: args.url, ready: false, error: 'URL must start with http/https' };
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
  description: 'Navigate to a URL using headless Chromium and return the page title and final URL. Requires Playwright to be installed.',
  inputSchema: navigateParams,
  outputSchema: navigateOutput,
  policy: 'auto',
  kind: 'readonly',
  execute: executeNavigate,
});
