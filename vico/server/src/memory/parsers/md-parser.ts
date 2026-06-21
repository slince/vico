/**
 * Markdown 解析器。
 * 支持 .md 和 .mdx 文件。
 */
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'markdown',
  supportedTypes: ['text/markdown', '.md', '.mdx'],
  parse: async (filePath) => ({
    text: readFileSync(filePath, 'utf-8'),
  }),
});
