// @vico/rag — Markdown parser
// Strips frontmatter, code blocks preserved

import type { Parser, ParseResult } from '../types/document.js';
import { readFile } from 'node:fs/promises';

/**
 * MarkdownParser — 解析 Markdown 文件为纯文本。
 *
 * 前端 YAML frontmatter 会被移除，代码块保留原样。
 */
export class MarkdownParser implements Parser {
  readonly name = 'markdown';
  readonly mimeTypes = ['text/markdown', 'text/x-markdown'];
  readonly extensions = ['.md', '.mdx', '.markdown'];

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

    // 去除 YAML frontmatter（--- 包围的元数据）
    let text = raw;
    if (text.startsWith('---')) {
      const end = text.indexOf('---', 3);
      if (end >= 0) {
        text = text.slice(end + 3).trimStart();
      }
    }

    return { text, metadata: {} };
  }
}
