// @vico/rag — Markdown structure-aware chunking
//
// 按 Markdown 标题层级（#, ##, ###, ...）切分，保持每个分块内部的文档结构。
// 子标题与父标题内容合并，确保每个 chunk 保留上下文路径。

import type { Chunk, ChunkOptions, Chunker } from '../types/chunk.js';

interface Section {
  heading: string;   // 标题行（含 # 前缀）
  level: number;     // 1-6
  content: string;   // 该 section 下的内容（不含子 section）
  path: string[];    // 从根到当前的标题路径
}

/** 匹配 Markdown 标题（ATX 风格） */
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

/**
 * MarkdownChunker — 按 Markdown 标题结构切分文本。
 *
 * 策略：
 * 1. 解析文档为 section 树（标题 + 内容）
 * 2. 每个 section 如果内容过长，递归降级为 paragraph/sentence 切分
 * 3. 每个 chunk 前缀包含标题路径，保持上下文
 */
export class MarkdownChunker implements Chunker {
  async chunk(text: string, options: ChunkOptions): Promise<Chunk[]> {
    const sections = this.parseSections(text);

    if (sections.length === 0) {
      // 无标题的纯文本，降级为按段落切分
      return this.splitPlain(text, options);
    }

    const chunks: Chunk[] = [];
    let index = 0;

    for (const section of sections) {
      const prefix = section.path.join(' > ') + '\n\n';
      const fullContent = prefix + section.content.trim();

      if (fullContent.length <= options.size) {
        chunks.push({ text: fullContent, index: index++, metadata: { headingPath: section.path } });
      } else {
        // 内容过长，按段落进一步切分
        const subChunks = this.splitPlain(section.content, options);
        for (const sub of subChunks) {
          const withPath = prefix + sub.text;
          chunks.push({ text: withPath, index: index++, metadata: { headingPath: section.path } });
        }
      }
    }

    return this.applyOverlap(chunks, options.overlap);
  }

  /** 解析文本为 section 数组 */
  private parseSections(text: string): Section[] {
    const lines = text.split('\n');
    const sections: Section[] = [];
    const pathStack: string[] = [];

    let currentSection: Section | null = null;
    let contentLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match && !line.startsWith('```')) {
        // 保存前一个 section
        if (currentSection) {
          currentSection.content = contentLines.join('\n');
          sections.push(currentSection);
          contentLines = [];
        }

        const level = match[1].length;
        const heading = match[2].trim();

        // 维护路径栈
        while (pathStack.length >= level) {
          pathStack.pop();
        }
        pathStack.push(heading);

        currentSection = { heading, level, content: '', path: [...pathStack] };
      } else {
        contentLines.push(line);
      }
    }

    // 最后一个 section
    if (currentSection) {
      currentSection.content = contentLines.join('\n');
      sections.push(currentSection);
    } else if (contentLines.length > 0) {
      // 没有标题，内容作为单个 section
      sections.push({
        heading: '',
        level: 0,
        content: contentLines.join('\n'),
        path: [],
      });
    }

    return sections;
  }

  /** 纯文本降级切分 */
  private splitPlain(text: string, options: ChunkOptions): Chunk[] {
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
    const chunks: Chunk[] = [];
    let current = '';
    let index = 0;

    for (const para of paragraphs) {
      if (current.length + para.length > options.size && current.length > 0) {
        chunks.push({ text: current.trim(), index: index++, metadata: {} });
        current = para;
      } else {
        current += (current ? '\n\n' : '') + para;
      }

      // 单个段落超出 size，强制切分
      while (current.length > options.size) {
        chunks.push({ text: current.slice(0, options.size), index: index++, metadata: {} });
        current = current.slice(options.size - options.overlap);
      }
    }

    if (current.trim()) {
      chunks.push({ text: current.trim(), index, metadata: {} });
    }

    return chunks;
  }

  /** overlap 处理 */
  private applyOverlap(chunks: Chunk[], overlap: number): Chunk[] {
    if (overlap <= 0 || chunks.length <= 1) return chunks;
    return chunks.map((c, i) => {
      if (i === 0) return c;
      return { ...c, text: chunks[i - 1].text.slice(-overlap) + '\n' + c.text };
    });
  }
}
