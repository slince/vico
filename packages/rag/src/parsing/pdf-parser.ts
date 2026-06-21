// @vico/rag — PDF parser
// Requires: pnpm add pdf-parse
// Gracefully degrades if not installed.

import type { Parser, ParseResult } from '../types/document.js';
import { readFile } from 'node:fs/promises';

/**
 * PdfParser — 使用 pdf-parse 提取 PDF 文本。
 *
 * pdf-parse 为可选 peerDependency，未安装时 parse 抛出明确错误。
 */
export class PdfParser implements Parser {
  readonly name = 'pdf';
  readonly mimeTypes = ['application/pdf'];
  readonly extensions = ['.pdf'];

  async parse(input: string | Buffer): Promise<ParseResult> {
    let buf: Buffer;

    if (Buffer.isBuffer(input)) {
      buf = input;
    } else {
      try {
        buf = await readFile(input);
      } catch {
        throw new Error(`PdfParser: cannot read file "${input}"`);
      }
    }

    try {
      // @ts-expect-error - pdf-parse has no types
      const pdfParse = await import('pdf-parse');
      const data = await pdfParse.default(buf);
      return {
        text: data.text,
        metadata: {
          pages: data.numpages,
          info: data.info,
        },
      };
    } catch (err: any) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'PdfParser requires pdf-parse.\n' +
          'Install: pnpm add pdf-parse'
        );
      }
      throw err;
    }
  }
}
