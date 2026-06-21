// @vico/rag — Document parser type definitions

/** 解析结果 */
export interface ParseResult {
  /** 提取的纯文本 */
  text: string;
  /** 文档标题（可选） */
  title?: string;
  /** 附加元数据（如 author、date、page_count 等） */
  metadata: Record<string, unknown>;
}

/** 文档解析器接口 */
export interface Parser {
  /** 名称（如 "pdf"、"markdown"） */
  name: string;
  /** 支持的 MIME 类型 */
  mimeTypes: string[];
  /** 支持的文件扩展名（含 . 前缀） */
  extensions: string[];
  /**
   * 解析文档输入，提取纯文本和元数据。
   * @param input - 文件路径 或 文本/Buffer 内容
   */
  parse(input: string | Buffer): Promise<ParseResult>;
}

/** 解析器注册表接口 */
export interface ParserRegistry {
  /** 注册解析器 */
  register(parser: Parser): void;
  /** 根据文件路径查找匹配的解析器 */
  findParser(filePath: string): Parser | undefined;
  /** 获取所有已注册的解析器 */
  list(): Parser[];
}
