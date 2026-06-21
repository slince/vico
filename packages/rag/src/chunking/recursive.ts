// @vico/rag — Recursive chunking: paragraph → sentence → character
import type { Chunk, ChunkOptions, Chunker } from '../types/chunk.js';

/** 分隔符优先级（从大到小） */
const DEFAULT_SEPARATORS = [
  '\n\n',   // 段落
  '\n',     // 行
  '。',     // 中文句号
  '. ',     // 英文句号
  '！',     // 中文感叹号
  '！',     // 中文感叹号
  '？',     // 中文问号
  '? ',     // 英文问号
  '；',     // 中文分号
  '; ',     // 英文分号
  '，',     // 中文逗号
  ', ',     // 英文逗号
  ' ',      // 空格
  '',        // 字符级
];

/**
 * RecursiveChunker — 按分隔符优先级递归切分文本。
 *
 * 策略：
 * 1. 尝试用最高优先级分隔符切分
 * 2. 每个片段 <= maxSize 则保留
 * 3. 超过 maxSize 的片段用下一级分隔符继续切
 * 4. overlap 通过相邻块尾部重叠实现
 */
export class RecursiveChunker implements Chunker {
  private separators: string[];

  constructor(separators?: string[]) {
    this.separators = separators ?? DEFAULT_SEPARATORS;
  }

  async chunk(text: string, options: ChunkOptions): Promise<Chunk[]> {
    const { size, overlap } = options;
    const chunks = this.split(text, size, 0);
    return this.applyOverlap(chunks, overlap);
  }

  /** 递归切分 */
  private split(text: string, maxSize: number, sepIndex: number): string[] {
    if (text.length <= maxSize || sepIndex >= this.separators.length) {
      return text.length > 0 ? [text] : [];
    }

    const separator = this.separators[sepIndex];
    if (!separator) {
      // 字符级：强制按 maxSize 切
      return this.forceSized(text, maxSize);
    }

    const parts = text.split(separator);
    const result: string[] = [];

    for (const part of parts) {
      if (part.length <= maxSize) {
        if (part.length > 0) result.push(part);
      } else {
        // 当前分隔符切完后仍太长，降级到下一级
        result.push(...this.split(part, maxSize, sepIndex + 1));
      }
    }

    // 合并过小的片段以充分利用 chunk size
    return this.mergeSmallChunks(result, maxSize, separator);
  }

  /** 强制按字符数切分（最终降级方案） */
  private forceSized(text: string, maxSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxSize) {
      chunks.push(text.slice(i, i + maxSize));
    }
    return chunks;
  }

  /** 合并过小的相邻片段 */
  private mergeSmallChunks(chunks: string[], maxSize: number, separator: string): string[] {
    if (chunks.length <= 1) return chunks;

    const result: string[] = [];
    let acc = chunks[0];

    for (let i = 1; i < chunks.length; i++) {
      const merged = acc + separator + chunks[i];
      if (merged.length <= maxSize) {
        acc = merged;
      } else {
        result.push(acc);
        acc = chunks[i];
      }
    }
    result.push(acc);
    return result;
  }

  /** 应用 overlap：每个块尾部与前一个块的重叠 */
  private applyOverlap(chunks: string[], overlap: number): Chunk[] {
    if (overlap <= 0 || chunks.length <= 1) {
      return chunks.map((text, index) => ({ text, index, metadata: {} }));
    }

    return chunks.map((text, index) => {
      const enriched = index > 0
        ? chunks[index - 1].slice(-overlap) + text
        : text;
      return { text: enriched, index, metadata: {} };
    });
  }
}
