# 知识库（RAG/Wiki）升级方案

## 现状 vs 目标差距总览

| 维度 | 当前状态 | 目标状态 |
|------|---------|---------|
| 文档解析 | 仅支持 txt/md/pdf/csv，pdf-parse 丢失结构 | 全格式（docx/xlsx/pptx/html/epub/图片OCR）+ 结构化提取 |
| 切片策略 | 全局固定 chunk_size=512, overlap=64, recursive | 按知识库可配置：固定长度/语义/标题层级/FAQ，可视化调节 |
| 检索方式 | 纯向量语义搜索（余弦相似度） | 混合检索（BM25 + 向量）+ Rerank 重排 |
| Agent 绑定 | 1:1（agents.kb_id 单字段） | 保持 1:1，通过 kb_id 绑定即可 |
| 文档管理 | 无文档表，chunks 列表硬编码为空数组 | 文档级生命周期管理（预览/重索引/删除/标签） |
| Chunk 操作 | 删除接口返回 501，列表返回 `[]` | 完整 CRUD：查询/删除/手动调整 |
| 检索配置 | 仅 `top_k=5`，全局不可配 | 知识库级可视化配置：阈值/召回数/权重/未命中策略 |
| 溯源引用 | 无 | 回答挂载引用标记，可点击展开原文 |
| 权限隔离 | 无 | 知识库级角色 + 文档标签级 + 检索前置过滤 |
| 数据看板 | 仅 `totalKnowledgeBases` 计数 | 检索量/Token消耗/命中排行/Agent 消耗明细 |
| 导入渠道 | 仅本地文件上传 | 文件/URL抓取/在线编辑器/批量导入 |
| 未命中处理 | 无策略，模型自由发挥 | 四种策略可选：自由/兜底/拒绝/转人工 |
| 文件去重 | 无，重复上传产生冗余向量 | SHA256 哈希去重，支持重新索引 |
| 嵌入模型 | 全局单一配置 | 按知识库可选不同嵌入模型 |

---

## 分阶段升级路线

### 第一阶段：补齐基础数据模型与文档管理（P0）

**目标**：修复当前功能残缺，建立后续所有工作的数据基础。

#### 1.1 新增 `documents` 表

当前 chunk 直接挂在知识库下，缺少文档层级，无法进行文档级管理。

```sql
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,           -- UUID
  tenant_id   TEXT NOT NULL,              -- FK -> organization.id
  kb_id       TEXT NOT NULL,              -- FK -> knowledge_bases.id
  filename    TEXT NOT NULL,
  file_type   TEXT NOT NULL,              -- 'txt'|'md'|'pdf'|'docx'|...
  file_size   INTEGER NOT NULL DEFAULT 0,
  file_hash   TEXT,                       -- SHA256，用于去重
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|parsing|indexing|ready|error
  error_msg   TEXT,                       -- 解析失败原因
  tags        TEXT DEFAULT '[]',          -- JSON 数组
  source      TEXT NOT NULL DEFAULT 'upload', -- upload|url|manual|import
  source_url  TEXT,                       -- 来源 URL
  metadata    TEXT DEFAULT '{}',          -- JSON，扩展元数据
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_documents_kb_id ON documents(kb_id);
CREATE INDEX idx_documents_tenant ON documents(tenant_id);
```

#### 1.2 实现 Chunk 管理 API

当前 `GET /api/v1/knowledge-bases/:id/chunks` 硬编码返回 `[]`，`DELETE .../chunks/:chunkId` 返回 501。

- **chunks 列表**：从 LibSQLVector 按 `indexName` 查询实际存储的 chunks，返回 `{ id, content, metadata, similarity }`
- **删除 chunk**：调用 `vector.delete({ indexName, ids: [chunkId] })`，同步更新 `documents.chunk_count` 和 `knowledge_bases.chunk_count`
- **单文档 chunks 查询**：`GET /api/v1/knowledge-bases/:id/documents/:docId/chunks`

#### 1.3 文件去重与重新索引

- 上传时计算文件 SHA256，查询同知识库内是否已存在
- 若存在，提示「文件已存在，是否重新索引？」
- 重新索引：删除该文档的所有旧 chunks → 重新解析 → 重新向量化 → 更新 `documents` 和 `knowledge_bases` 计数

#### 1.4 文档级 API

```
GET    /api/v1/knowledge-bases/:id/documents              # 文档列表（分页+筛选）
GET    /api/v1/knowledge-bases/:id/documents/:docId       # 文档详情
DELETE /api/v1/knowledge-bases/:id/documents/:docId       # 删除文档及其所有 chunks
POST   /api/v1/knowledge-bases/:id/documents/:docId/reindex # 重新索引
PATCH  /api/v1/knowledge-bases/:id/documents/:docId       # 更新文档标签/元数据
```

---

### 第二阶段：增强检索能力（P0）

**目标**：检索质量核心提升，从"能用"到"好用"。

#### 2.1 知识库级可配置参数

`knowledge_bases` 表新增 `config` 列（JSON），替代全局固定配置：

```json
{
  "chunk": {
    "size": 512,
    "overlap": 64,
    "strategy": "recursive"
  },
  "retrieval": {
    "top_k": 5,
    "similarity_threshold": 0.7,
    "keyword_weight": 0.3,
    "vector_weight": 0.7
  },
  "rerank": {
    "enabled": false,
    "model": "bge-reranker-v2-m3"
  },
  "no_match": {
    "strategy": "free_answer",
    "fallback_message": "抱歉，未找到相关知识。"
  }
}
```

`ragManager.indexText()` 和 `createRagSearchTool()` 从知识库配置读取参数，覆盖全局默认值。

前端：知识库编辑页新增「检索配置」Tab，可视化滑块调节各项参数。

#### 2.2 BM25 关键词检索

- 新增 `src/memory/keyword-search.ts`
- 使用 SQLite FTS5 扩展为每个知识库建立全文索引：

```sql
CREATE VIRTUAL TABLE kb_<kbId>_fts USING fts5(
  chunk_id, content, filename, metadata
);
```

- 入库时：向量写入 LibSQLVector + 文本写入 FTS5 表
- 删除时：同步清理 FTS5 索引
- 检索接口：`searchKeyword(kbId, query, topK)` → BM25 分值排序

#### 2.3 混合检索

- 新增 `src/memory/hybrid-search.ts`
- 并行执行 BM25 关键词搜索 + 向量语义搜索
- RRF（Reciprocal Rank Fusion）融合两路结果：

```
RRF_score = Σ 1 / (k + rank_i)
```

- 支持通过 `keyword_weight` / `vector_weight` 调节偏向
- 替换 `rag-tool.ts` 中直接调用的向量查询，改为混合检索

#### 2.4 Query Rewrite 查询改写

- 新增 `src/memory/query-rewrite.ts`
- 检索前通过轻量 LLM 调用改寫用户问题：
  - 拆分复合问题为多个简单查询
  - 补充同义关键词
  - 纠正可能拼写错误
- 多次搜索取并集，提升低召回场景命中率
- 知识库配置开关控制（`query_rewrite.enabled`）

#### 2.5 Rerank 重排序

- 引入 Cross-Encoder 重排模型（如 `bge-reranker-v2-m3` 或 Transformers.js `Xenova/bge-reranker-base`）
- 流程：混合检索 Top-N（如 20 条）→ Rerank 模型二次打分 → 取 Top-K（如 5 条）
- 前端开关一键启用/关闭
- 重排模型懒加载，首次使用时初始化

---

### 第三阶段：回答质量与溯源（P1）

**目标**：解决幻觉问题，企业合规必备。

#### 3.1 强制引用与溯源

- 修改 `rag-tool.ts`，工具返回格式标准化：

```
[source: 文档名#chunk3] 内容文本...
```

- Agent 系统提示词注入引用规则：

> 每条结论必须标注来源，格式为 [source: 文档名]。如果无法从检索上下文确认，请明确说明"无相关资料支持该结论"。

- 前端对话消息组件解析 `[source: ...]` 标记，渲染为可点击链接，点击展开原文片段

#### 3.2 未命中策略实现

知识库配置中 `no_match.strategy` 四模式：

| 策略 | 行为 |
|------|------|
| `free_answer` | 允许模型自有知识补充，标注「以下回答基于通用知识」 |
| `fallback` | 返回 `fallback_message` 兜底文案 |
| `reject` | 直接告知「抱歉，未找到相关知识」 |
| `transfer` | 触发人工工单流程（预留接口） |

`rag-tool.ts` 在检索结果为 0 且均分低于阈值时，按对应策略处理。

#### 3.3 上下文压缩

- 新增 `src/memory/context-compression.ts`
- 当混合检索返回的 chunks 拼接后超过 Token 预算（如 3K tokens）时：
  - 调用轻量 LLM 对多 chunk 进行摘要压缩
  - 保留关键事实和数据，丢弃冗余描述
- 控制每次 RAG 调用的输入 Token 成本

---

### 第四阶段：文件解析增强（P1）

**目标**：提升内容覆盖率，降低接入门槛。

#### 4.1 扩展文件格式支持

```
已有: .txt .md .pdf .csv
新增: .docx (mammoth), .xlsx (xlsx/SheetJS),
      .pptx (officegen 反向解析), .html (cheerio → text),
      .epub, .json, .xml,
      图片 OCR (tesseract.js 或云端 OCR API)
```

新增 `src/memory/parsers/` 目录，每种格式独立解析器，统一接口：

```ts
interface DocumentParser {
  supportedTypes: string[];
  parse(filePath: string): Promise<{
    text: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }>;
}
```

`KnowledgeManager.uploadFile()` 中引入 `ParserRegistry` 按文件类型路由。

#### 4.2 PDF 结构化解析升级

- 替换 `pdf-parse` 为 `pdf.js`（Mozilla），获取：
  - 标题层级（通过字体大小/加粗推断）
  - 段落边界
  - 表格区域识别
  - 阅读顺序保证
- 输出统一 Markdown 结构化文本，保留标题层级用于后续「标题层级切片」

#### 4.3 URL 导入

- 新增 `POST /api/v1/knowledge-bases/:id/import-url`，接受 `{ url, depth?: number }`
- 后端抓取网页（fetch + cheerio/turndown）→ HTML → Markdown → 创建 document 记录 → 切片 → 向量化
- `depth > 1` 时递归抓取同域子页面链接
- 进度回报：通过 SSE 或轮询返回抓取进度

#### 4.4 在线 Markdown 编辑器

- 前端知识库详情页新增「新建文档」按钮
- 内置 Markdown 编辑器（可使用 `@assistant-ui/react-markdown` 预览）
- AI 辅助：摘要生成、润色、翻译
- 保存后自动创建 document → 切片 → 向量化入库
- 编辑已有文档后自动重新切片更新索引（无需重新上传）

---

### 第五阶段：权限与安全（P2）

**目标**：多租户安全，企业场景必需。

#### 5.1 知识库级角色权限

```sql
CREATE TABLE knowledge_permissions (
  id        TEXT PRIMARY KEY,
  kb_id     TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'viewer', -- admin|editor|viewer
  created_at INTEGER NOT NULL,
  UNIQUE(kb_id, user_id)
);
```

- `admin`：全操作（编辑配置/增删文档/管理权限/删除知识库）
- `editor`：增改文档，不能修改配置和权限
- `viewer`：仅检索预览

API 中间件 `requireKbRole(kbId, roles[])` 校验当前用户对该知识库的操作权限。

#### 5.2 文档标签与权限过滤

- 文档标签支持：手动自定义标签 + AI 自动生成标签（调用 LLM 摘要提取关键词）
- 敏感标签（如「高管可见」「财务部」）对应权限分组
- 检索前置过滤：
  - 检索时携带用户权限标签集合
  - 在向量/关键词检索后，过滤掉用户无权访问的文档 chunks
  - 越权文档完全不参与结果，杜绝信息泄露

#### 5.3 全链路审计日志

```sql
CREATE TABLE knowledge_audit_logs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kb_id       TEXT,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,       -- upload|edit|delete|search|agent_call|config_update
  target_type TEXT,                -- knowledge_base|document|chunk
  target_id   TEXT,
  detail      TEXT DEFAULT '{}',   -- JSON，包含查询内容、结果数、时间等
  ip_address  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_audit_logs_kb ON knowledge_audit_logs(kb_id);
CREATE INDEX idx_audit_logs_user ON knowledge_audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON knowledge_audit_logs(action);
```

- 所有知识库操作（上传/编辑/删除/检索/Agent调用/配置修改）写入审计日志
- 前端模块：知识库详情页「审计日志」Tab，支持时间范围/操作类型筛选，导出 CSV

---

### 第六阶段：数据看板与用量统计（P2）

**目标**：成本可视化，运营决策支撑。

#### 6.1 检索用量统计

```sql
CREATE TABLE rag_usage_stats (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  kb_id           TEXT NOT NULL,
  agent_id        TEXT,
  thread_id       TEXT,
  session_id      TEXT,
  query_text      TEXT,
  chunks_retrieved INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  response_time_ms INTEGER NOT NULL DEFAULT 0,
  hit             INTEGER NOT NULL DEFAULT 0,  -- 0|1 是否命中有效结果
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_rag_usage_kb ON rag_usage_stats(kb_id);
CREATE INDEX idx_rag_usage_agent ON rag_usage_stats(agent_id);
CREATE INDEX idx_rag_usage_time ON rag_usage_stats(created_at);
```

- RAG 工具执行时写入统计记录（异步，不阻塞检索）
- 统计 Token：检索输入（chunks 拼接后长度估算）+ 模型输出

#### 6.2 三层维度统计

- **会话维度**：单条对话调用知识库产生的 Token 消耗，前端 ThreadList 展示
- **知识库维度**：单个知识库被所有 Agent 调用的总量，知识库详情页「统计」Tab
- **Agent 维度**：关联所有知识库的全量消耗，后台大盘 Agent 消耗排行

#### 6.3 前端看板

全局知识库大盘（首页仪表盘扩展）：
- 总知识库数、总文档数、今日检索量、总 Token 消耗、存储使用率
- 7 日检索量/新增文档/Token 消耗趋势折线图
- Agent 维度消耗排行

单知识库统计（知识库详情页）：
- 近 7/30 日检索趋势折线
- 高频检索词 Top10
- 单文档命中次数排行

告警规则：
- 存储超阈值、检索量突增、Token 消耗突增
- 解析失败文档弹窗提醒

---

### 第七阶段：高级能力（P3，按需推进）

| 能力 | 说明 |
|------|------|
| **检索缓存** | 对高频相同/相似问题进行结果缓存（问题 Embedding → 近似匹配），减少重复 Embedding + 检索开销 |
| **多模态检索** | 图片 OCR 文本向量化 + CLIP 图片视觉向量联合检索 |
| **时间权重衰减** | 新文档优先返回（传入时间衰减因子），过期知识自动降权 |
| **知识库联合检索** | Agent 对话同时检索多个知识库，按配置权重合并排序结果 |
| **版本快照** | 保存知识库配置快照，支持一键回滚切片/检索参数 |
| **增量索引** | 检测文件变更，仅重新索引变化部分 |
| **并发检索** | 企业级支持 ≥50 并发检索，引入请求队列和池化 |
| **多语言增强** | 跨语言检索（中文提问匹配英文文档），多语言分块策略优化 |
| **外部向量库** | 支持 Pinecone/pgvector/Weaviate/Qdrant 作为可替换后端 |
| **知识图谱** | 实体关系抽取 + GraphRAG 增强检索 |

---

## 实施优先级总览

| 优先级 | 阶段 | 核心价值 | 工作量 | 风险 |
|--------|------|---------|--------|------|
| **P0** | 第一阶段：文档表 + chunks API | 修复功能残缺，所有后续工作的基础 | 1-2 周 | 低 |
| **P0** | 第二阶段：混合检索 + 可配置参数 | 检索质量核心提升，决定 RAG 可用性 | 2-3 周 | 中 |
| **P1** | 第三阶段：溯源引用 + 未命中策略 | 解决幻觉，企业合规必备 | 1-2 周 | 低 |
| **P1** | 第四阶段：文件格式扩展 + URL 导入 | 提升内容覆盖率，降低接入门槛 | 1-2 周 | 低 |
| **P2** | 第五阶段：权限 + 审计 | 多租户安全，企业场景必需 | 1-2 周 | 中 |
| **P2** | 第六阶段：看板 + 用量统计 | 成本可视化，运营决策支撑 | 1-2 周 | 低 |
| **P3** | 第七阶段：高级能力 | 差异化竞争力 | 按需 | 中高 |

---

## 关键设计决策

1. **文档表设计**：新增 `documents` 表作为 chunk 和知识库之间的中间层，解决当前无文档级管理的问题。所有 chunk 的 metadata 中需额外存储 `document_id` 以支持关联查询和级联删除。

2. **FTS5 与向量存储双写一致**：BM25 索引和向量索引需保证事务一致性。建议将两者封装为统一的 `IndexWriter`，入库和删除操作原子化。

3. **嵌入模型选择**：当前全局使用 `openai/text-embedding-3-small`。按知识库可选模型需注意不同模型的向量维度可能不同（如 `text-embedding-3-large` 为 3072 维），切换模型需要重建整个向量索引。

4. **重排模型选型**：推荐优先使用 Transformers.js 本地运行 `bge-reranker-base`（约 1GB），避免 API 延迟和成本。后续可扩展云端重排 API。
