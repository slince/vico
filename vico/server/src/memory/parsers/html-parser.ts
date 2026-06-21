/**
 * HTML 解析器。
 * 去除 script/style 标签后提取纯文本。
 */
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'html',
  supportedTypes: ['text/html', '.html', '.htm'],
  parse: async (filePath) => {
    const html = readFileSync(filePath, 'utf-8');
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, '\n')
      .trim();
    return { text };
  },
});
