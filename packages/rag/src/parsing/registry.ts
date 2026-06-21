// @vico/rag — ParserRegistry: pluggable document parser registry

import type { Parser, ParserRegistry, ParseResult } from '../types/document.js';
import { extname, basename } from 'node:path';

/**
 * DefaultParserRegistry — 基于 MIME type / 扩展名的解析器注册表。
 *
 * @example
 * ```ts
 * const registry = new DefaultParserRegistry();
 * registry.register(new TextParser());
 * const parser = registry.findParser('document.md');
 * const result = await parser.parse('...');
 * ```
 */
export class DefaultParserRegistry implements ParserRegistry {
  private parsers: Parser[] = [];

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
