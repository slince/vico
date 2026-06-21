// @vico/rag — CSV parser

import type { Parser, ParseResult } from '../types/document.js';
import { readFile } from 'node:fs/promises';

/**
 * CsvParser — 读取 CSV 文件内容为纯文本。
 */
export class CsvParser implements Parser {
  readonly name = 'csv';
  readonly mimeTypes = ['text/csv'];
  readonly extensions = ['.csv'];

  async parse(input: string | Buffer): Promise<ParseResult> {
    if (Buffer.isBuffer(input)) {
      return { text: input.toString('utf-8'), metadata: {} };
    }

    try {
      const content = await readFile(input, 'utf-8');
      return { text: content, metadata: { source: input } };
    } catch {
      // 当作原始 CSV 字符串
      return { text: input, metadata: {} };
    }
  }
}
