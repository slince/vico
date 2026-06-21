// @vico/rag — Chunking type definitions

/** 分块策略 */
export type ChunkStrategy = 'recursive' | 'markdown' | 'code' | 'sentence' | 'character';

/** 分块配置 */
export interface ChunkOptions {
  strategy: ChunkStrategy;
  /** 最大分块大小（字符数） */
  size: number;
  /** 相邻分块重叠字符数 */
  overlap: number;
  /** 自定义分隔符列表（strategy 为 character 时使用） */
  separators?: string[];
}

/** 单个分块 */
export interface Chunk {
  text: string;
  index: number;
  metadata: Record<string, unknown>;
}

/** 分块器接口 */
export interface Chunker {
  chunk(text: string, options: ChunkOptions): Promise<Chunk[]>;
}
