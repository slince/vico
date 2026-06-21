/**
 * DOCX 解析器。
 * 使用 mammoth 库提取文本，动态导入以避免未安装时阻塞启动。
 */
import { readFileSync } from 'node:fs';
import mammoth from 'mammoth';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'docx',
  supportedTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  parse: async (filePath) => {
    const buf = readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value };
  },
});
