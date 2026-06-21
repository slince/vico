/**
 * PDF 解析器。
 * 使用 pdf-parse 库提取文本，动态导入以避免未安装时阻塞启动。
 */
import { readFileSync } from 'node:fs';
import pdfParse from 'pdf-parse';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'pdf',
  supportedTypes: ['application/pdf', '.pdf'],
  parse: async (filePath) => {
    const buf = readFileSync(filePath);
    const data = await pdfParse(buf);
    return { text: data.text };
  },
});
