/**
 * 纯文本解析器。
 * 支持 .txt 及常见代码文件扩展名。
 */
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'txt',
  supportedTypes: ['text/plain', '.txt', '.py', '.js', '.json', '.xml', '.yaml', '.yml'],
  parse: async (filePath) => ({
    text: readFileSync(filePath, 'utf-8'),
  }),
});
