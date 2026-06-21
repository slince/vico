// @vico/rag — HTML parser
// Strips script/style tags then extracts plain text.

import type { Parser, ParseResult } from '../types/document.js';
import { readFile } from 'node:fs/promises';

/**
 * HtmlParser — 去除 script/style 标签后提取 HTML 纯文本。
 */
export class HtmlParser implements Parser {
  readonly name = 'html';
  readonly mimeTypes = ['text/html'];
  readonly extensions = ['.html', '.htm'];

  async parse(input: string | Buffer): Promise<ParseResult> {
    let raw: string;

    if (Buffer.isBuffer(input)) {
      raw = input.toString('utf-8');
    } else {
      try {
        raw = await readFile(input, 'utf-8');
      } catch {
        raw = input;
      }
    }

    const text = raw
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, '\n')
      .trim();

    return { text, metadata: {} };
  }
}
