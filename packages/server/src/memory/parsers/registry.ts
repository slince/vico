/**
 * ParserRegistry — 可扩展的文档解析器注册中心。
 *
 * 每个解析器声明它支持的文件类型（MIME 或扩展名），
 * 通过 findParser 可以按文件路径和可选 MIME 类型查找匹配的解析器。
 */

export interface ParserResult {
  text: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentParser {
  name: string;
  supportedTypes: string[];       // ['text/plain', '.txt']
  parse(filePath: string, options?: any): Promise<ParserResult>;
}

class ParserRegistry {
  private parsers: DocumentParser[] = [];

  /** 注册一个解析器 */
  register(parser: DocumentParser): void {
    this.parsers.push(parser);
  }

  /** 根据文件路径和可选 MIME 类型查找解析器 */
  findParser(filePath: string, mimeType?: string): DocumentParser | null {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    return this.parsers.find((p) =>
      p.supportedTypes.some((t) => t === mimeType || t === ext),
    ) ?? null;
  }

  /** 获取所有已注册的解析器 */
  getAll(): DocumentParser[] {
    return this.parsers;
  }
}

export const parserRegistry = new ParserRegistry();
