// @vico/browser-tool - browser_snapshot 工具：提取页面可见文本快照
import {z} from 'zod';
import {createTool} from '@vico/tool';
import type {ToolCallContext} from '@vico/tool';
import {checkPlaywright, launchBrowser, playwrightInstallError} from './browser-playwright.js';

const snapshotParams = z.object({
  url: z.string().describe('The URL to capture a snapshot of'),
});

const snapshotOutput = z.object({
  text: z.string(),
  url: z.string(),
  error: z.string().optional(),
});

async function executeSnapshot(args: z.infer<typeof snapshotParams>, _ctx: ToolCallContext) {
  if (!await checkPlaywright()) {
    return { text: '', url: args.url, error: playwrightInstallError() };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(args.url, { timeout: 30000, waitUntil: 'domcontentloaded' });

    const text = await page.evaluate(() => {
      document.querySelectorAll('script, style, noscript').forEach((e) => e.remove());
      return document.body?.innerText?.slice(0, 20000) || '(empty page)';
    });

    return { text, url: page.url() };
  } finally {
    await browser.close();
  }
}

export const browserSnapshotTool = createTool({
  name: 'browser_snapshot',
  description: 'Capture a text snapshot of a page (visible text only). Used to extract page content without HTML tags. Requires Playwright.',
  inputSchema: snapshotParams,
  outputSchema: snapshotOutput,
  policy: 'auto',
  kind: 'readonly',
  execute: executeSnapshot,
});
