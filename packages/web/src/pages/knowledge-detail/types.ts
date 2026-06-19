/** 文档块数据结构 */
export interface ChunkItem {
  id: string;
  content: string;
  metadata: string;
}

/** 知识库中的文档 */
export interface DocumentItem {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: string;
  source: string;
  created_at: number;
}

/** 知识库详情数据结构 */
export interface KnowledgeBaseDetail {
  id: string;
  name: string;
  description: string | null;
  source: string;
  chunk_count: number;
}

/** 分页文档列表 */
export interface PaginatedDocuments {
  data: DocumentItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 分页分块列表 */
export interface PaginatedChunks {
  data: ChunkItem[];
  total: number;
  page: number;
  page_size: number;
}
