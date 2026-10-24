// @vico/browser-tool - browser_click 工具：点击页面元素并返回新页面信息
import {z} from 'zod';
import {createTool} from '@vico/tool';
import type {ToolCallContext} from '@vico/tool';
import {checkPlaywright, launchBrowser, playwrightInstallError} from './browser-playwright.js';

const clickParams = z.object({
  url: z.string().describe('The URL of the current page'),
  selector: z.string().describe('CSS selector of the element to click'),
  text: z.string().optional().describe('Click the element containing this text (selector takes priority)'),
});

const clickOutput = z.object({
  title: z.string(),
  url: z.string(),
  clicked: z.boolean(),
  error: z.string().optional(),
});

async function executeClick(args: z.infer<typeof clickParams>, _ctx: ToolCallContext) {
  if (!await checkPlaywright()) {
    return { title: '', url: args.url, clicked: false, error: playwrightInstallError() };
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
      return { title: '', url: page.url(), clicked: false, error: 'Please provide either selector or text' };
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

    return { title: await page.title(), url: page.url(), clicked: true };
  } finally {
    await browser.close();
  }
}

export const browserClickTool = createTool({
  name: 'browser_click',
  description: 'Click a page element (by CSS selector or text match), wait for any navigation, and return the new page info. Requires Playwright.',
  inputSchema: clickParams,
  outputSchema: clickOutput,
  policy: 'auto',
  kind: 'readonly',
  execute: executeClick,
});
