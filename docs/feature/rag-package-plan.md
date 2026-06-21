# @vico/rag 基础包架构规划

## 1. 定位

`@vico/rag` 是一个**框架无关**的标准 RAG 能力库，提供文档摄取、分块、嵌入、向量检索、重排序、查询改写等核心能力。上层（`@vico/agent`、`vico/server`）按需组合使用。

**核心原则：**
- 零硬依赖（chunking 自己实现，embedding/reranker 作为可选插件）
- 接口驱动（Embedder、VectorStore、Reranker、Parser 都是接口，各包实现）
- 内置轻量默认实现（InMemory 系列，开箱即用）
- 不与特定框架（Hono、Drizzle、Mastra）绑定

## 2. 包结构

```
packages/rag/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # 公共导出
    │
    ├── types/                      # 核心类型
    │   ├── index.ts
    │   ├── chunk.ts                # Chunk、ChunkStrategy、Chunker
    │   ├── embedder.ts             # Embedder（单条 + 批量）、BatchEmbedResult
    │   ├── vector-store.ts         # VectorStore 接口（add/search/delete/upsert/query）
    │   ├── document.ts             # Document、Parser、ParserRegistry
    │   ├── retrieval.ts            # SearchResult、SearchOptions、RetrievalPipeline
    │   ├── reranker.ts             # Reranker 接口
    │   └── config.ts               # RagConfig 全局配置
    │
    ├── chunking/                   # 分块实现
    │   ├── index.ts
    │   ├── recursive.ts            # 递归分块（paragraph → sentence → char）
    │   ├── markdown.ts             # Markdown 结构感知分块
    │   ├── code.ts                 # 代码感知分块（按 function/class 边界）
    │   └── sentence.ts             # 句子级分块
    │
    ├── embedding/                  # 嵌入器
    │   ├── index.ts                # 创建/解析 embedder 的工厂
    │   ├── fastembed.ts            # 本地 ONNX embedder
    │   └── openai.ts               # OpenAI-compatible embedder
    │
    ├── vector-store/               # 内置向量存储
    │   └── in-memory.ts            # InMemoryVectorStore（数组 + cosine）
    │
    ├── retrieval/                  # 检索管道
    │   ├── index.ts                # RetrievalPipeline 编排器
    │   ├── query-rewrite.ts        # LLM 查询改写（子问题拆分、同义词扩展）
    │   ├── hybrid-search.ts        # 混合搜索（dense + sparse/BM25 加权融合）
    │   ├── reranker.ts             # Cross-Encoder 重排序
    │   ├── dedup.ts                # 结果去重
    │   └── formatter.ts            # 结果格式化（source 标记）
    │
    ├── parsing/                    # 文档解析器
    │   ├── index.ts                # ParserRegistry
    │   ├── text-parser.ts          # 纯文本解析
    │   ├── markdown-parser.ts      # Markdown 解析
    │   ├── pdf-parser.ts           # PDF 解析
    │   └── html-parser.ts          # HTML 解析
    │
    └── tool/                       # Agent 工具
        └── rag-tool.ts             # 标准 RAG 检索工具（AI SDK tool() 构建）
```

## 3. 核心接口设计

### 3.1 Chunker（分块器）

```typescript
export type ChunkStrategy = 'recursive' | 'markdown' | 'code' | 'sentence' | 'character';

export interface ChunkOptions {
  strategy: ChunkStrategy;
  size: number;         // max chunk size (chars)
  overlap: number;      // overlap between chunks
}

export interface Chunk {
  text: string;
  index: number;
  metadata: Record<string, unknown>;
}

export interface Chunker {
  chunk(text: string, options: ChunkOptions): Promise<Chunk[]>;
}
```

### 3.2 Embedder（嵌入器）

```typescript
export interface BatchEmbedOptions {
  values: string[];
  model?: string;
}

export interface BatchEmbedResult {
  embeddings: number[][];
  usage?: { tokens: number };
}

/** 批量嵌入器 — 一次调用嵌入多段文本 */
export interface BatchEmbedder {
  doEmbed(options: BatchEmbedOptions): Promise<BatchEmbedResult>;
}
```

### 3.3 VectorStore（向量存储）

```typescript
export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorQueryResult {
  id: string;
  score: number;       // 0-1 similarity
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  /** 创建索引（幂等） */
  createIndex(params: {
    indexName: string;
    dimension: number;
    metric: 'cosine' | 'euclidean' | 'dot_product';
  }): Promise<void>;

  /** 批量 upsert 向量 */
  upsert(params: {
    indexName: string;
    vectors: number[][];
    ids: string[];
    metadata: Record<string, unknown>[];
  }): Promise<void>;

  /** 相似度查询 */
  query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;  // metadata 过滤
  }): Promise<VectorQueryResult[]>;

  /** 删除向量 */
  deleteVectors(params: {
    indexName: string;
    ids: string[];
  }): Promise<void>;

  /** 删除索引 */
  dropIndex(indexName: string): Promise<void>;
}
```

### 3.4 Reranker（重排序器）

```typescript
export interface Reranker {
  rerank(query: string, results: VectorQueryResult[]): Promise<VectorQueryResult[]>;
}
```

### 3.5 Parser（文档解析器）

```typescript
export interface ParseResult {
  text: string;
  title?: string;
  metadata: Record<string, unknown>;
}

export interface Parser {
  mimeTypes: string[];
  extensions: string[];
  parse(input: string | Buffer): Promise<ParseResult>;
  /** null if the path doesn't match this parser */
  canParse?(filePath: string): boolean;
}
```

### 3.6 RetrievalPipeline（检索管道）

```typescript
export interface SearchOptions {
  query: string;
  indexName: string;
  topK?: number;
  similarityThreshold?: number;
  filter?: Record<string, unknown>;
  enableRewrite?: boolean;
  enableRerank?: boolean;
  enableHybrid?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface RetrievalPipeline {
  search(options: SearchOptions): Promise<SearchResult[]>;
}
```

## 4. 关键流程

### 4.1 摄入流程

```
文件/文本 → ParserRegistry.findParser() → Parser.parse() → 纯文本
     ↓
  Chunker.chunk(text, { strategy: 'recursive', size: 512, overlap: 64 })
     ↓  Chunk[]
  BatchEmbedder.doEmbed({ values: chunkTexts })
     ↓  number[][]
  VectorStore.upsert({ indexName, vectors, ids, metadata })
     ↓
  完成
```

### 4.2 检索流程

```
用户查询
     ↓ (optional) QueryRewriter.rewrite(query) → queries[]
     ↓
  embedder.doEmbed({ values: queries }) → queryVectors[]
     ↓ (optional) HybridSearcher: dense + BM25 → fused results
     ↓
  VectorStore.query({ indexName, queryVector, topK, filter })
     ↓  VectorQueryResult[]
  去重 → 相似度过滤 → 排序
     ↓ (optional) Reranker.rerank(query, results)
     ↓  SearchResult[]
  格式化 "{ [source: #]content }"
```

## 5. 与现有包的职责划分

| 包 | 职责 | 依赖 `@vico/rag`? |
|---|---|---|
| `@vico/rag` | 核心 RAG 能力（chunking、embedding、检索管道、解析器） | — |
| `@vico/agent` | Agent 类型定义、AgentLoop、Memory 子系统 | imports 类型（VectorStore、Embedder 等接口） |
| `@vico/chroma-adapter` | Chroma 版 VectorStore 实现 | implements VectorStore |
| `@vico/libsql-adapter` | LibSQL 版 VectorStore 实现 | implements VectorStore |
| `@vico/mysql-adapter` | MySQL 版 VectorStore 实现 | implements VectorStore |
| `vico/server` | 业务层：RAGManager、KB CRUD、文件上传 | imports 核心能力 + 组合使用 |

## 6. 迁移路径

### 阶段 1：创建 `@vico/rag` 包基础结构
- 迁移核心类型定义（从 `@vico/agent` 的 `memory/types.ts` 提取通用部分）
- 实现 chunking（recursive 优先，取替 @mastra/rag MDocument）
- 迁移 InMemoryVectorStore
- 迁移 ParserRegistry + 各地 parser
- 迁移 Embedder 接口和 fastembed/openai 实现

### 阶段 2：实现检索管道
- RetrievalPipeline 编排器
- QueryRewriter（LLM 驱动，非 stub）
- HybridSearcher（dense + BM25 加权融合）
- Reranker（Cross-Encoder，先保持可选依赖）
- 去重 + 格式化

### 阶段 3：迁移上层
- `@vico/agent` 的 `RagProvider`、`MemoryStore` 引用切换到 `@vico/rag` 类型
- 各 adapter 依赖切换到 `@vico/rag`
- `vico/server` 的 `RAGManager`、`rag-tool` 切换到 `@vico/rag`
- 移除 `@mastra/rag` 依赖

## 7. 关键设计决策

| 决策 | 理由 |
|---|---|
| Chunking 自己实现 | `@mastra/rag` 目前仅 MDocument 在用，自己实现 recursive/markdown 两种策略即可覆盖 90% 场景，避免重依赖 |
| Embedder 接口保留 `doEmbed(values[])` 批量签名 | 单条嵌入场景可传 `[text]`，避免定义两套接口 |
| VectorStore 从 Memory API 分离 | 当前 VectorStore 的 `add(search)` 签名为 Memory 记忆场景设计（`MemoryRecord`），RAG 需要更通用的 `upsert/query` 语义（indexName + filter） |
| Reranker 保持可选依赖 | Transformers.js 体积大（~500MB），作为 peerDependency，运行时按需加载 |
| Parser 从 server 层上移到 rag 包 | parser 是 RAG 摄入的必备能力，且无 server 层特有依赖（如 Drizzle、Hono），放入基础包更合理 |
