# 标准 RAG 库能力模型

以 `@mastra/rag` 为参照，梳理一个成熟 RAG 库应具备的完整能力体系，并对照 Vico 当前实现标注状态。

---

## 1. 文档摄取与解析 (Document Ingestion & Parsing)

**用途**：将多种来源、多种格式的原始文档转换为可处理的纯文本，是 RAG 管道的入口。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| 多格式解析 | 支持 PDF、DOCX、HTML、Markdown、TXT、CSV、JSON 等常见格式的结构化提取 | MDocument.fromText/HTML/Markdown/JSON | PDF (pdf-parse)、DOCX (mammoth)、HTML、MD、TXT、CSV，ParserRegistry 可插拔 |
| URL 导入 | 从远程 URL 拉取并解析网页内容 | 通过工具实现 | 已实现，fetch + HTML 清洗 |
| 手动创建 | 用户直接输入文本创建文档 | — | 已实现 |
| 文件上传管线 | 校验（MIME type、magic bytes、大小）、SHA256 去重、存储 | 依赖外部 | 已实现，StorageManager 支持 local/S3 |
| 解析器注册表 | 新增格式时无需改动现有代码 | — | ParserRegistry 已实现 |
| 图片/音频/视频 OCR | 对非文本类文件提取文字信息 | — | 未实现 |

---

## 2. 分块策略 (Chunking Strategies)

**用途**：将长文档切分为适合嵌入和检索的语义片段。策略选择直接影响召回精度。

| 策略 | 用途 | Mastra | Vico |
|---|---|---|---|
| `recursive` | 按段落/句子/字符优先级递归切分，最通用 | ✅ | ✅ (MDocument) |
| `character` | 单一分隔符切分，适合格式规整的文本 | ✅ | ✅ |
| `token` | 按 token 数切分，精确控制 LLM 上下文窗口 | ✅ | — |
| `markdown` | Markdown 标题/段落感知切分，保持文档结构 | ✅ | — |
| `html` | HTML DOM 结构感知切分 | ✅ | — |
| `json` | JSON 结构递归感知切分 | ✅ | — |
| `latex` | LaTeX 文档类型切分 | ✅ | — |
| `sentence` | 按句子边界切分 | ✅ | — |
| `semantic-markdown` | 语义感知的 Markdown 切分 | ✅ | — |
| 代码感知切分 | 对 20+ 编程语言做 AST 级切分 | ✅ | — |
| 可配置参数 | chunk size、overlap、separators | ✅ chunk size/overlap | ✅ 512/64 |

**Vico 现状**：仅透传 `recursive` 策略，其余策略和代码切分均未实现。

---

## 3. 嵌入模型 (Embedding)

**用途**：将文本块转换为向量，是语义搜索的基础。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| 本地嵌入 | ONNX 本地推理，零 API 成本，适合脱敏场景 | fastembed | fastembed |
| 云端嵌入 | 调用 OpenAI/Cohere 等云端嵌入 API | ModelRouterEmbeddingModel | OpenAI text-embedding-3-small |
| 批量嵌入 | 单次 API 调用嵌入多个文本块，节省延迟和费用 | ✅ doEmbed(values[]) | ✅ |
| 多模型切换 | 不同 KB 使用不同嵌入模型 | — | — |
| 嵌入缓存 | 相同文本不重复嵌入 | — | — |
| 稀疏向量 | BM25 / SPLADE 稀疏向量支持，用于混合搜索 | ✅ (Pg/Pinecone) | — |

**Vico 现状**：已实现单模型批量嵌入，但无多模型选择、无嵌入缓存、无稀疏向量。

---

## 4. 向量存储 (Vector Store)

**用途**：持久化向量并支持高效相似度搜索，是 RAG 的"记忆"。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| 多后端支持 | Pinecone、PgVector、Chroma、Qdrant、Elasticsearch、LibSQL | ✅ | LibSQL、Chroma、MySQL |
| 相似度搜索 | cosine / euclidean / dot_product | ✅ | cosine only |
| 相似度阈值过滤 | 过滤低相关度结果 | ✅ | ✅ (0.7) |
| 元数据过滤 | 按文档来源、日期、标签等业务字段过滤 | ✅ | ✅ (metadata JSON) |
| 命名空间/索引隔离 | 不同 KB 的数据物理隔离 | ✅ indexName | ✅ kb_{uuid} |
| CRUD 操作 | upsert、delete、update chunks | ✅ | upsert、delete by doc |
| 批量操作 | 批量 upsert/delete | ✅ | ✅ |
| HNSW 索引 | 更精确的近似最近邻 | ✅ (PgVector) | — |
| 稀疏向量存储 | 存储稀疏+稠密向量 | ✅ (Pinecone) | — |

**Vico 现状**：已有 3 个 VectorStore 适配器，功能完整但缺少 HNSW 索引调参、稀疏向量存储等高级选项。

---

## 5. 检索 (Retrieval)

**用途**：根据用户查询从向量库中找到最相关的文档块。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| 语义搜索 (Dense) | 基于向量相似度的语义匹配 | ✅ | ✅ |
| 关键词搜索 (Sparse/BM25) | 精确关键词匹配，适合专业术语 | ✅ (Pg/Pinecone) | — |
| 混合搜索 | 语义 70% + 关键词 30%，兼顾语义和精确 | ✅ (Elasticsearch) | — |
| topK 控制 | 返回最相关的前 K 个结果 | ✅ | ✅ (5) |
| 多重查询检索 | 从一个查询生成多个变体分别检索 | — | ✅ (query rewrite stub) |
| 查询意图分类 | 自动判断是否需要检索 | — | — |
| 运行时过滤覆盖 | Agent 调用时动态指定 indexName/topK/filter | ✅ RequestContext | — |

**Vico 现状**：纯语义搜索，无关键词/混合搜索。查询改写仅 stub，意图分类未实现。

---

## 6. 检索后处理 (Post-Retrieval Processing)

**用途**：对召回结果做二次加工，提升最终返回给 LLM 的内容质量。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| Rerank（重排序） | 用 Cross-Encoder 对候选块再次打分排序 | ✅ rerank/rerankWithScorer | ✅ (BGE-reranker-base，默认关闭) |
| 上下文压缩 | 当检索结果过长时压缩，避免超出 token 限制 | — | ✅ (简单截断 6000 字符) |
| 去重 | 合并多次检索/多查询的重复结果 | — | ✅ (by vector ID) |
| 结果格式化 | 按 source 标记引用来源 | — | ✅ `[source: file#chunk]` |
| LLM 摘要压缩 | 用 LLM 对检索结果做摘要压缩而非简单截断 | — | stub，未实现 |
| 多样性控制 (MMR) | Maximal Marginal Relevance，平衡相关性和多样性 | — | — |

**Vico 现状**：有基本的去重、格式化、截断压缩，rerank 可选但默认关闭。缺少 MMR 和 LLM 压缩。

---

## 7. 元数据提取 (Metadata Extraction)

**用途**：从文档中自动提取结构化元信息，用于过滤和增强检索。

| 提取器 | 用途 | Mastra | Vico |
|---|---|---|---|
| TitleExtractor | 自动提取文档标题 | ✅ | — |
| SummaryExtractor | LLM 生成文档摘要 | ✅ | — |
| KeywordExtractor | 提取关键词标签 | ✅ | — |
| QuestionsAnsweredExtractor | 提取文档能回答的问题列表 | ✅ | — |
| SchemaExtractor | 用 Zod Schema 提取自定义结构化数据 | ✅ | — |

**Vico 现状**：完全未实现。文档有 filename、source、MIME type 基础元数据，但无 LLM 驱动的自动提取。

---

## 8. 高级 RAG 特性 (Advanced RAG)

**用途**：在基础 RAG 之上提供更高维度的知识组织和检索能力。

| 特性 | 用途 | Mastra | Vico |
|---|---|---|---|
| GraphRAG | 从文档块构建知识图谱，用随机游走发现间接关联信息 | ✅ createGraphRAGTool | — |
| 假设文档嵌入 (HyDE) | 用 LLM 先生成假设答案再嵌入检索 | — | — |
| 自查询检索 | LLM 从问题中提取查询+过滤条件 | — | — |
| 父子块检索 (Parent-Child) | 检索小块获得精度，返回大块保留上下文 | — | — |
| 多跳检索 | 多步迭代检索，前一步结果指导下一步 | — | — |

**Vico 现状**：完全未实现。

---

## 9. 知识库管理 (Knowledge Management)

**用途**：面向业务的知识库组织能力。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| 多知识库 | 按主题/项目隔离文档 | — | ✅ KB CRUD |
| 文档生命周期 | pending → parsing → indexing → ready → error 状态流转 | — | ✅ |
| 文件夹层级 | 虚拟目录组织文档 | — | ✅ |
| KB ↔ Agent 绑定 | Agent 可关联一个或多个知识库 | — | ✅ 1:1 (agent_knowledge_bases 表预留 N:N) |
| 文件预览/下载 | 前端查看文档内容和下载原始文件 | — | ✅ |
| 重新索引 | 修改文档后重新分块嵌入 | — | 501 not implemented |
| 分块粒度管理 | 列出/删除单个 chunk | — | ✅ REST API |
| 批量段落操作 | 批量增删改 chunks | — | — |

**Vico 现状**：KB 层面的管理比较完整，但重新索引和批量 chunk 操作未实现。

---

## 10. 可观测性 (Observability)

**用途**：追踪 RAG 管道每一步的执行情况，用于调试和性能优化。

| 能力 | 用途 | Mastra (1.24+) | Vico |
|---|---|---|---|
| 摄入追踪 (RAG_INGESTION) | 追踪文档摄入全流程 | ✅ | — |
| 嵌入追踪 (RAG_EMBEDDING) | 追踪嵌入调用次数、延迟 | ✅ | — |
| 向量操作追踪 (RAG_VECTOR_OPERATION) | 追踪向量存储 I/O | ✅ | — |
| RAG 动作追踪 (RAG_ACTION) | 追踪 chunk/rerank/extract 等操作 | ✅ | — |
| 图谱操作追踪 (GRAPH_ACTION) | 追踪 GraphRAG 构建/遍历/更新 | ✅ | — |
| 检索命中率统计 | 追踪哪些查询触发了检索，命中率如何 | — | — |
| 端到端延迟 | 摄入/检索全链路耗时 | — | — |

**Vico 现状**：Agent 层面有 SpanTracker，但 RAG 管线内部无专项追踪。

---

## 11. Agent 工具集成 (Agent Tool Integration)

**用途**：将 RAG 能力暴露为 Agent 可调用的 Tool。

| 能力 | 用途 | Mastra | Vico |
|---|---|---|---|
| 向量搜索工具 | Agent 可调用 `search_knowledge_base` 检索知识 | ✅ createVectorQueryTool | ✅ createRagSearchTool |
| GraphRAG 工具 | Agent 可调用图谱增强检索 | ✅ createGraphRAGTool | — |
| 无匹配策略 | 检索无结果时的兜底行为 | — | ✅ free_answer / fallback / reject |
| rag_mode 自动/禁用 | 按 Agent 控制是否启用 RAG | — | ✅ auto / disabled |

---

## 能力优先级评估

按业务价值和技术复杂度，建议实现优先级：

### P0（已具备，持续完善）
- 多格式文档解析、文件上传管线
- 基础分块 (recursive)、批量嵌入
- 向量存储 CRUD、语义搜索
- 检索后去重/格式化/截断
- 知识库管理、Agent 绑定

### P1（近期补齐）
- **Rerank 默认开启**（当前有实现但默认关闭）
- **混合搜索（语义+BM25）** — 显著提升精确术语场景的召回率
- **元数据过滤增强** — 按文档、日期、标签过滤
- **多查询改写 LLM 实现**（当前仅有 stub）
- **RAG 可观测性** — 摄入/检索追踪
- **重新索引**

### P2（中期规划）
- **Markdown/HTML 结构感知分块** — 提升文档结构敏感场景质量
- **代码感知分块** — 提升代码库 RAG 精度
- **元数据自动提取** (标题/摘要/关键词)
- **多模型嵌入** — 不同 KB 不同模型
- **嵌入缓存** — 减少重复嵌入成本

### P3（远景规划）
- **GraphRAG** — 知识图谱增强检索
- **HyDE** — 假设文档嵌入
- **父子块检索** — 精度+上下文兼得
- **LLM 摘要压缩** — 替代简单截断
- **多跳检索** — 迭代式深度检索
