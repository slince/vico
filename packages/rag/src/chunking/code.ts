// @vico/rag — Code-aware chunking
//
// 按函数定义、类定义、接口定义的边界切分代码。
// 支持 TypeScript / JavaScript / Python / Go / Rust。

import type { Chunk, ChunkOptions, Chunker } from '../types/chunk.js';

/** 函数定义正则 — 跨语言匹配 */
const FUNC_RE = /^(\s*)(export\s+)?(async\s+)?(function\s+|class\s+|interface\s+|def\s+|fn\s+|pub\s+fn\s+)/;

/** 类成员定义 */
const METHOD_RE = /^\s{2,}(public\s+|private\s+|protected\s+|async\s+)?(\w+)\s*\(/;

/**
 * CodeChunker — 按代码结构边界切分。
 *
 * 策略：
 * 1. 识别顶级定义（function/class/interface/def/fn）
 * 2. 每个定义作为一个潜在分块
 * 3. 过小的定义合并，过大的定义在方法边界进一步切分
 * 4. 保留 imports / package declaration 等作为 preamble 块
 */
export class CodeChunker implements Chunker {
  async chunk(text: string, options: ChunkOptions): Promise<Chunk[]> {
    const blocks = this.parseBlocks(text);
    const chunks: Chunk[] = [];
    let index = 0;

    for (const block of blocks) {
      if (block.length <= options.size) {
        chunks.push({ text: block, index: index++, metadata: { kind: 'block' } });
      } else {
        // 过大的块在方法/内部边界切分
        const subChunks = this.splitLargeBlock(block, options);
        for (const sub of subChunks) {
          chunks.push({ text: sub, index: index++, metadata: { kind: 'sub_block' } });
        }
      }
    }

    // 合并过小的 chunk 以充分利用空间
    return this.mergeSmallChunks(chunks, options.size, options.overlap);
  }

  /** 解析代码为逻辑块 */
  private parseBlocks(code: string): string[] {
    const lines = code.split('\n');
    const blocks: string[] = [];
    let currentBlock: string[] = [];
    let preamble: string[] = [];

    let inPreamble = true;

    for (const line of lines) {
      const isTopLevel = FUNC_RE.test(line) && !line.includes('=>');

      if (inPreamble && isTopLevel) {
        inPreamble = false;
        // 保存 preamble（imports / package 等）
        if (preamble.length > 0) {
          blocks.push(preamble.join('\n'));
          preamble = [];
        }
      }

      if (!inPreamble && isTopLevel && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }

      if (inPreamble) {
        preamble.push(line);
      } else {
        currentBlock.push(line);
      }
    }

    // 最后一个块
    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'));
    } else if (preamble.length > 0 && blocks.length === 0) {
      blocks.push(preamble.join('\n'));
    }

    return blocks;
  }

  /** 对过大块在方法边界进一步切分 */
  private splitLargeBlock(block: string, options: ChunkOptions): string[] {
    const lines = block.split('\n');
    const chunks: string[] = [];
    let current: string[] = [];
    const indent = this.detectIndent(block);

    for (const line of lines) {
      const isMethod = METHOD_RE.test(line) && !line.includes('=>');

      if (isMethod && current.length > 0 && current.join('\n').length + line.length > options.size) {
        chunks.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }

    if (current.length > 0) {
      const text = current.join('\n');
      if (text.length <= options.size) {
        chunks.push(text);
      } else {
        // 仍过长，强制按字符切分
        for (let i = 0; i < text.length; i += options.size) {
          chunks.push(text.slice(i, i + options.size));
        }
      }
    }

    return chunks;
  }

  /** 合并过小的相邻块 */
  private mergeSmallChunks(chunks: Chunk[], maxSize: number, overlap: number): Chunk[] {
    const result: Chunk[] = [];
    let acc = chunks[0];

    for (let i = 1; i < chunks.length; i++) {
      const merged = acc.text + '\n' + chunks[i].text;
      if (merged.length <= maxSize) {
        acc = { text: merged, index: acc.index, metadata: { ...acc.metadata } };
      } else {
        result.push(acc);
        acc = chunks[i];
      }
    }
    result.push(acc);

    // 重新编号
    return result.map((c, i) => ({ ...c, index: i }));
  }

  private detectIndent(code: string): number {
    const match = code.match(/^(\s+)/m);
    return match ? match[1].length : 2;
  }
}
