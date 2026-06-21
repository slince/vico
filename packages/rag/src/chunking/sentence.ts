// @vico/rag — Sentence-level chunking
import type { Chunk, ChunkOptions, Chunker } from '../types/chunk.js';

/**
 * SentenceChunker — 按句子边界切分文本。
 *
 * 策略：
 * 1. 按中英文句子结束符号切分
 * 2. 将句子合并为不超过 size 的块
 * 3. overlap 通过在块间保留边界句子实现
 */
const SENTENCE_RE = /(?<=[。！？.!?\n])\s*/;

export class SentenceChunker implements Chunker {
  async chunk(text: string, options: ChunkOptions): Promise<Chunk[]> {
    const { size, overlap } = options;
    const sentences = text.split(SENTENCE_RE).filter((s) => s.trim().length > 0);

    const chunks: Chunk[] = [];
    let current = '';
    let index = 0;

    for (const sentence of sentences) {
      if (current.length + sentence.length > size && current.length > 0) {
        chunks.push({ text: current, index: index++, metadata: {} });
        // overlap: 保留前一个块的最后一个句子
        current = overlap > 0 ? (chunks[index - 1].text.slice(-overlap) + sentence) : sentence;
      } else {
        current += (current.length > 0 ? '' : '') + sentence;
      }
    }

    if (current.length > 0) {
      chunks.push({ text: current, index, metadata: {} });
    }

    return chunks;
  }
}
