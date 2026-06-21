// @vico/rag — DOCX parser
// Requires: pnpm add mammoth
// Gracefully degrades if not installed.

import type { Parser, ParseResult } from '../types/document.js';
import { readFile } from 'node:fs/promises';

/**
 * DocxParser — 使用 mammoth 提取 .docx 文本。
 *
 * mammoth 为可选 peerDependency，未安装时 parse 抛出明确错误。
 */
export class DocxParser implements Parser {
  readonly name = 'docx';
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  readonly extensions = ['.docx'];

  async parse(input: string | Buffer): Promise<ParseResult> {
    let buf: Buffer;

    if (Buffer.isBuffer(input)) {
      buf = input;
    } else {
      try {
        buf = await readFile(input);
      } catch {
        throw new Error(`DocxParser: cannot read file "${input}"`);
      }
    }

    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return { text: result.value, metadata: {} };
    } catch (err: any) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'DocxParser requires mammoth.\n' +
          'Install: pnpm add mammoth'
        );
      }
      throw err;
    }
  }
}
