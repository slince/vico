/**
 * CSV 解析器。
 * 读取 CSV 文件内容为纯文本。
 */
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'csv',
  supportedTypes: ['text/csv', '.csv'],
  parse: async (filePath) => ({
    text: readFileSync(filePath, 'utf-8'),
  }),
});
