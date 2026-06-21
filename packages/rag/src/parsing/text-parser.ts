// @vico/rag — Plain text parser

import type { Parser, ParseResult } from '../types/document.js';
import { readFile } from 'node:fs/promises';

/** 文本文件扩展名 */
const TEXT_EXTENSIONS = [
  '.txt', '.py', '.js', '.ts', '.jsx', '.tsx',
  '.json', '.xml', '.yaml', '.yml', '.toml',
  '.sql', '.graphql', '.sh', '.bash', '.zsh',
  '.env', '.gitignore', '.dockerignore',
  '.css', '.scss', '.less',
  '.html', '.htm', '.svg',
];

/**
 * TextParser — 纯文本文件解析器。
 *
 * 支持扩展名见 TEXT_EXTENSIONS。
 * 对于文件路径，通过 fs 读取；对于字符串，直接返回。
 */
export class TextParser implements Parser {
  readonly name = 'text';
  readonly mimeTypes = ['text/plain'];
  readonly extensions = TEXT_EXTENSIONS;

  async parse(input: string | Buffer): Promise<ParseResult> {
    if (Buffer.isBuffer(input)) {
      return { text: input.toString('utf-8'), metadata: {} };
    }

    // 可能是文件路径
    try {
      const content = await readFile(input, 'utf-8');
      return { text: content, metadata: { source: input } };
    } catch {
      // 当作纯文本内容
      return { text: input, metadata: {} };
    }
  }
}
