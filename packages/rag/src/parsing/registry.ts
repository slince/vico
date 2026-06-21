// @vico/rag — ParserRegistry: pluggable document parser registry

import type { Parser, ParserRegistry } from '../types/document.js';
import { extname } from 'node:path';
import { TextParser } from './text-parser.js';
import { MarkdownParser } from './markdown-parser.js';
import { PdfParser } from './pdf-parser.js';
import { DocxParser } from './docx-parser.js';
import { CsvParser } from './csv-parser.js';
import { HtmlParser } from './html-parser.js';

/**
 * DefaultParserRegistry — 基于扩展名的解析器注册表，默认注册全部内置 parser。
 *
 * @example
 * ```ts
 * const parser = new DefaultParserRegistry().findParser('document.md');
 * const result = await parser!.parse('...');
 * ```
 */
export class DefaultParserRegistry implements ParserRegistry {
  private parsers: Parser[] = [];

  constructor() {
    this.register(new TextParser());
    this.register(new MarkdownParser());
    this.register(new PdfParser());
    this.register(new DocxParser());
    this.register(new CsvParser());
    this.register(new HtmlParser());
  }

  register(parser: Parser): void {
    this.parsers.push(parser);
  }

  findParser(filePath: string): Parser | undefined {
    const ext = extname(filePath).toLowerCase();
    return this.parsers.find(
      (p) => p.extensions.map((e) => e.toLowerCase()).includes(ext),
    );
  }

  list(): Parser[] {
    return [...this.parsers];
  }
}
