# Vico - 面向中小企业的通用 Agent 平台 设计文档

## 概述

Vico 是一款面向中小企业的通用 Agent 产品，核心能力是 Agent + Skill 的组合式架构。企业可以通过管理端配置 Agent、安装/卸载 Skill、管理知识库，实现如员工管理、工程报价方案生成等场景化智能助手能力。

### 核心决策

| 决策维度 | 选择 |
|----------|------|
| MVP 范围 | 全模块（Agent引擎 + 管理端 + 预设Skill + 记忆 + 工具调用 + RAG） |
| LLM 策略 | 多模型可切换（OpenAI / Anthropic / DeepSeek / 国产模型 / 自定义） |
| 部署模式 | SaaS 多租户 + 私有化部署 |
| Skill 机制 | 文件系统 + Manifest 插拔式 |
| Agent 框架 | Vercel AI SDK v5 |
| 存储方案 | SQLite (better-sqlite3) + 文件存储 |
| 向量化 | Transformers.js（本地） + OpenAI Embedding API（在线）双模式 |
| 认证体系 | MVP 简单 JWT 登录，后续增强 |
| 前端 | React 19 + shadcn-ui + Vite |
| 后端 | Fastify + TypeScript |

---

## 一、总体架构

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Client Layer                        │
│  ┌──────────────────────┐  ┌───────────────────────────┐ │
│  │   Admin Web (React)  │  │  End-user Chat (Widget)   │ │
│  │   shadcn-ui + Vite   │  │  可嵌入企业网站/内部系统    │ │
│  └──────────┬───────────┘  └─────────────┬─────────────┘ │
└─────────────┼─────────────────────────────┼──────────────┘
              │ REST API                    │ SSE/Stream
┌─────────────┼─────────────────────────────┼──────────────┐
│             ▼               Server        ▼              │
│  ┌──────────────────────────────────────────────────┐   │
│  │              HTTP Layer (Fastify)                 │   │
│  │  /api/admin/* (管理API)   /api/chat/* (对话API)   │   │
│  └────────┬─────────────────────────┬────────────────┘   │
│           ▼                         ▼                    │
│  ┌────────────────┐   ┌───────────────────────────┐     │
│  │  Admin Module  │   │     Agent Runtime          │     │
│  │  用户/租户/配置 │   │  ┌─────────────────────┐  │     │
│  │  Agent CRUD    │   │  │  Chat Pipeline      │  │     │
│  │  Skill 管理    │   │  │  (AI SDK stream)    │  │     │
│  │  对话记录      │   │  └─────────┬───────────┘  │     │
│  └────────┬───────┘   │           ▼               │     │
│           │           │  ┌─────────────────────┐  │     │
│           │           │  │  Tool Executor      │  │     │
│           │           │  │  (function calling) │  │     │
│           │           │  └─────────┬───────────┘  │     │
│           │           │           ▼               │     │
│           │           │  ┌─────────────────────┐  │     │
│           │           │  │  Skill Manager      │  │     │
│           │           │  │  (加载/注册/路由)   │  │     │
│           │           │  └─────────┬───────────┘  │     │
│           │           │           ▼               │     │
│           │           │  ┌─────────────────────┐  │     │
│           │           │  │  Memory Manager     │  │     │
│           │           │  │  (短期+长期+ RAG)   │  │     │
│           │           │  └─────────────────────┘  │     │
│           ▼           └───────────────────────────┘     │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Data Layer (better-sqlite3)          │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │         File System: skills/ 目录                  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 核心分层职责

| 层 | 模块 | 职责 |
|----|------|------|
| HTTP | Fastify | 路由分发、认证中间件、SSE 流式响应 |
| Admin | admin/ | 管理API：租户、Agent、Skill、对话记录CRUD |
| Agent | agent/ | Chat Pipeline：接收消息→加载上下文→调用LLM→执行工具→流式返回 |
| Tool | agent/tool | 管理 tool 注册表，执行 LLM 返回的 function call |
| Skill | skill/ | 扫描 skills/ 目录→解析 manifest→注册工具→注入 prompt |
| Memory | memory/ | 短期(会话窗口)+长期(向量检索)+RAG(混合检索)记忆管理 |
| Data | data/ | SQLite 数据库操作，迁移管理 |

### 目录结构

```
vico/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── admin/          # 管理端 API
│   │   │   │   ├── router.ts
│   │   │   │   ├── agent.ts
│   │   │   │   ├── skill.ts
│   │   │   │   ├── conversation.ts
│   │   │   │   └── dashboard.ts
│   │   │   ├── agent/          # Agent 运行时
│   │   │   │   ├── pipeline.ts
│   │   │   │   ├── tool-executor.ts
│   │   │   │   └── model-registry.ts
│   │   │   ├── skill/          # Skill 系统
│   │   │   │   ├── manager.ts
│   │   │   │   ├── loader.ts
│   │   │   │   └── types.ts
│   │   │   ├── memory/         # 记忆管理
│   │   │   │   ├── short-term.ts
│   │   │   │   ├── long-term.ts
│   │   │   │   ├── rag.ts
│   │   │   │   └── embedder.ts
│   │   │   ├── data/           # 数据层
│   │   │   │   ├── db.ts
│   │   │   │   └── migrations/
│   │   │   ├── auth/           # 认证
│   │   │   └── index.ts
│   │   └── server.config.yaml
│   ├── web/                    # React 管理端
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Dashboard.tsx
│   │       │   ├── Agents.tsx / AgentDetail.tsx
│   │       │   ├── Skills.tsx
│   │       │   ├── Conversations.tsx / ConversationDetail.tsx
│   │       │   ├── KnowledgeBases.tsx / KnowledgeDetail.tsx
│   │       │   └── Settings.tsx
│   │       ├── components/
│   │       │   ├── ui/         # shadcn-ui 组件
│   │       │   ├── layout/     # Sidebar, Header, Layout
│   │       │   ├── chat/       # ChatWindow, MessageBubble
│   │       │   └── agents/     # AgentCard, SkillBindingPanel, ModelSelector
│   │       └── hooks/
│   │           ├── useChat.ts
│   │           └── useAuth.ts
│   └── skills/                 # 预设 + 自定义 Skill
│       ├── employee-mgmt/
│       │   ├── manifest.json
│       │   ├── prompt.md
│       │   ├── tools.ts
│       │   └── resources/      # 知识库文档
│       └── quotation-generator/
│           ├── manifest.json
│           ├── prompt.md
│           ├── tools.ts
│           └── resources/
├── docker-compose.yml
├── package.json                # pnpm workspaces
└── turbo.json
```

---

## 二、Agent 编排引擎

### 对话管道流程

```
用户消息
   │
   ▼
1. 路由解析 → 2. 加载上下文(Agent配置+Skill列表) → 3. 构建上下文(短期记忆+长期记忆+RAG)
   │
   ▼
4. 组装 Tool 集(从绑定 Skill 收集 tool 定义) → 5. 构造 LLM 请求(System Prompt + Messages + Tools)
   │
   ▼
6. Vercel AI SDK streamText 流式调用
   ├── tool_call  → 7. Tool Executor → 结果注入 → 回到 6
   └── text_delta → 8. SSE 流式推送客户端
   │
   ▼
9. 持久化(对话记录 + 更新记忆)
```

### 多模型适配

基于 Vercel AI SDK 的 provider 抽象层，统一接口：

- OpenAI: 原生支持
- Anthropic: 原生支持
- DeepSeek/通义千问等: 通过 `createOpenAI({ baseURL, apiKey })` 适配
- 自定义/Ollama: 通过 `createOpenAI` 自定义 endpoint

```typescript
interface ModelConfig {
  id: string;
  provider: 'openai' | 'anthropic' | 'deepseek' | 'qwen' | 'custom';
  modelName: string;
  apiKey: string;
  baseURL?: string;
  temperature: number;
  maxTokens: number;
}
```

### System Prompt 组装策略

```
System Prompt (按拼接顺序):
├── Agent Base System Prompt (管理端配置)
├── Skill A Prompt Template (Manifest注入)
├── Skill B Prompt Template
├── 长期记忆检索结果 (用户事实/偏好)
├── RAG 检索结果 (知识库文档)
└── 短期记忆 (最近 N 轮对话窗口)
```

### Tool Executor

```
LLM tool_call → Tool Registry(运行时注册表) → 权限检查 → 参数校验 → 执行 handler → 结果序列化 → 审计日志
```

### 流式响应 (SSE)

```typescript
type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: any }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: TokenUsage }
```

---

## 三、Skill 插件系统

### Skill 文件结构

```
skills/{skill-name}/
├── manifest.json     # 必须：元数据与参数定义
├── prompt.md         # 必须：注入的 system prompt 片段
├── tools.ts          # 必须：tool 定义与 handler
└── resources/        # 可选：知识库文档
```

### Manifest 规范

```json
{
  "name": "employee-mgmt",
  "displayName": "员工管理助手",
  "version": "1.0.0",
  "description": "员工信息查询、排班管理、请假审批等",
  "category": "hr",
  "parameters": {
    "db_path": { "type": "string", "label": "员工数据库路径", "default": "" }
  },
  "required_tools": [],
  "dependencies": [],
  "enabled": true
}
```

### Skill 生命周期

```
DISCOVER(扫描目录) → LOAD(解析文件) → REGISTER(注册工具) → ACTIVE(运行中)
                                                              │
                                                        DISABLED(禁用/卸载)
```

### 核心接口

```typescript
interface SkillManager {
  discover(): Promise<SkillManifest[]>;
  load(name: string): Promise<LoadedSkill>;
  register(name: string, agentId: string): void;
  unregister(name: string, agentId: string): void;
  getTools(agentId: string): SkillTool[];
  getPrompt(agentId: string): string;
  configure(name: string, params: Record<string, any>): void;
}
```

### Agent 与 Skill 绑定

- 一个 Skill 可被多个 Agent 绑定
- 绑定时可覆盖 Skill 参数配置（不同 Agent 使用不同参数值）
- 管理端可视化勾选/拖拽方式配置绑定关系

### 预设 Skill

**employee-mgmt (员工管理)**:
- `list_employees` - 员工列表查询/搜索
- `get_employee` - 获取单个员工详情
- `query_attendance` - 考勤记录查询
- `request_leave` - 发起请假流程

**quotation-generator (工程报价方案生成)**:
- `search_material_price` - 查询物料/材料价格
- `search_labor_cost` - 查询人工成本标准
- `calculate_quotation` - 计算报价总金额
- `generate_quotation_doc` - 生成报价方案文档

### 插拔式安装流程

1. 上传 Skill 压缩包 / 从预设选择 → 解压到 `skills/{tenantId}/{name}/`
2. 配置参数 → 写入 tenant skill config
3. 启用 → SkillManager.register() 解析 tools.ts + 注入 prompt
4. 绑定到 Agent → agent_skills 关联表写入，即刻生效

---

## 四、记忆管理 & RAG

### 双层记忆模型

| 类型 | 存储 | 容量 | 检索方式 |
|------|------|------|----------|
| 短期记忆 (STM) | 内存/SQLite messages 表 | 最近 20 轮 | FIFO 窗口 |
| 长期记忆 (LTM) | SQLite memory_entries 表 + 向量 | 10000 条 | 语义检索 |
| RAG 知识库 | SQLite chunks 表 + 向量 | 不限 | 混合检索(语义+关键词) |

### 短期记忆

- 滑动窗口模型，容量 N 轮（默认 20）
- 超限自动淘汰最早消息
- 窗口满时可选触发摘要 → 转入长期记忆

### 长期记忆

- 向量化存储用户事实、偏好、决策、摘要
- 每轮对话后异步提取关键信息（MVP 用规则，后续可升级 LLM 提取）
- 检索时计算余弦相似度 TopK

### RAG 知识库

**两层知识来源**:

1. **Skill 内置知识库**: Skill `resources/` 目录文档，安装时自动入库
2. **租户自定义知识库**: 管理端上传 PDF/DOCX/MD/TXT/CSV

**Ingestion Pipeline**:
```
上传文档 → 文件解析 → 清洗 → 智能分块(512 tokens, 64 overlap) → 向量化 → 入库
```

**检索策略**:
- 混合检索 = 语义相似度(0.7) + 关键词 BM25(0.3)
- 两种注入模式：自动注入(适合小知识库) / Tool 调用(适合大知识库)

**向量化方案**:
- 内置模式: Transformers.js (Xenova/all-MiniLM-L6-v2)，适合私有化/离线
- API 模式: OpenAI text-embedding-3-small，适合 SaaS/在线

### System Prompt 上下文组装顺序

```
1. Agent Base Prompt
2. Skill Prompt(s)
3. 长期记忆 (相关事实/偏好)
4. RAG 检索结果 (知识库文档)
5. 短期记忆 (最近 N 轮对话)
6. 用户消息
```

---

## 五、管理端前端

### 技术栈

| 项 | 选型 |
|----|------|
| 框架 | React 19 + Vite |
| UI | shadcn-ui + Tailwind CSS 4 |
| 路由 | react-router v7 |
| 状态管理 | TanStack Query v5 (服务端) + React Context (auth/tenant) |
| 对话流 | Vercel AI SDK useChat hook |
| 图表 | recharts |

### 路由结构

```
/login                登录
/dashboard            仪表盘总览（Token消耗、对话统计、活跃Agent）
/agents               Agent 列表
/agents/:id           Agent 配置详情（System Prompt、模型、Skill绑定、知识库绑定、测试对话）
/skills               Skill 管理（列表、安装、启用/禁用、参数配置）
/knowledge            知识库列表
/knowledge/:id        知识库详情（文档管理、分块查看）
/conversations        对话记录列表
/conversations/:id    对话详情回放（消息列表 + tool_call 展开 + Token/耗时统计）
/settings             LLM 模型设置 + 系统配置
```

### 状态管理策略

- React Context: 全局状态 (auth, tenant, theme)
- TanStack Query: 所有 API 数据（自动缓存/失效/重试）
- Vercel AI SDK useChat: 对话流状态
- 组件内部 useState: 表单、UI 交互

---

## 六、后端 API

### API 总览

```
认证:
  POST   /api/v1/auth/login
  POST   /api/v1/auth/register
  GET    /api/v1/auth/me

Agent 管理:
  GET/POST         /api/v1/agents
  GET/PATCH/DELETE /api/v1/agents/:id
  PUT              /api/v1/agents/:id/skills
  PUT              /api/v1/agents/:id/knowledge

Skill 管理:
  GET    /api/v1/skills
  GET    /api/v1/skills/:name
  POST   /api/v1/skills/install
  PATCH  /api/v1/skills/:name/config
  POST   /api/v1/skills/:name/toggle
  DELETE /api/v1/skills/:name

知识库:
  GET/POST         /api/v1/knowledge-bases
  GET/DELETE       /api/v1/knowledge-bases/:id
  POST             /api/v1/knowledge-bases/:id/upload
  DELETE           /api/v1/knowledge-bases/:id/chunks/:chunkId

对话:
  POST   /api/v1/chat              (SSE 流)
  GET    /api/v1/conversations
  GET/DELETE /api/v1/conversations/:id

系统:
  GET/POST         /api/v1/models
  PATCH/DELETE     /api/v1/models/:id
  GET              /api/v1/dashboard/stats

租户:
  GET    /api/v1/tenant/info
  PATCH  /api/v1/tenant/settings
```

### 认证

- JWT Bearer Token，payload: `{ userId, tenantId, role, exp }`
- 中间件链: CORS → Body Parse → Auth(JWT解析) → Tenant注入 → Logger → Rate Limit → Handler

### 租户隔离

- SaaS 模式: SQLite 单文件 + tenant_id 行级隔离，所有查询自动 `WHERE tenant_id = ctx.tenantId`
- 私有部署模式: 独立 SQLite 文件，跳过 tenant 检查

---

## 七、数据库设计

### 核心表

| 表名 | 用途 |
|------|------|
| tenants | 租户信息 |
| users | 用户认证 |
| agents | Agent 配置（system_prompt, model, temp, rag_mode） |
| agent_skills | Agent ↔ Skill 多对多绑定（含参数覆盖） |
| agent_knowledge_bases | Agent ↔ 知识库多对多绑定 |
| model_configs | LLM 模型配置（provider, api_key, base_url） |
| installed_skills | 已安装 Skill 记录（含用户配置参数） |
| conversations | 对话会话 |
| messages | 对话消息（含 tool_calls JSON） |
| memory_entries | 长期记忆（含 embedding BLOB） |
| knowledge_bases | 知识库定义 |
| chunks | 文档块（含 embedding BLOB） |
| tool_call_logs | 工具调用审计日志 |
| token_usage_logs | Token 消耗统计 |

### 关键索引

- `messages(conversation_id, created_at)`
- `memory_entries(tenant_id, user_id)`
- `chunks(kb_id)`
- agent_skills / agent_knowledge_bases 联合主键

---

## 八、部署方案

### 技术栈总览

| 层 | 技术 |
|----|------|
| 包管理 | pnpm workspaces + Turborepo |
| 前端 | React 19 + Vite + shadcn-ui + Tailwind CSS 4 |
| 后端 | Fastify + TypeScript |
| Agent | Vercel AI SDK v5 |
| 数据库 | better-sqlite3 |
| 向量化 | Transformers.js (本地) / OpenAI Embedding (在线) |
| 运行时 | Node.js 20+ |

### SaaS 部署 (Docker)

```
docker-compose.yml:
  vico-server: Node.js 后端 (可横向扩展)
  vico-web: Nginx + 静态资源
  volumes: skills/, data/
```

### 私有化部署 (PM2)

单命令启动，配置文件指定 `DEPLOY_MODE: private`，跳过租户隔离。数据目录可自定义。

### 配置清单

```yaml
server:
  port: 3001
  deploy_mode: private | saas

auth:
  jwt_secret: "${JWT_SECRET}"
  token_expiry: 7d

database:
  path: "./data/vico.db"

skills:
  scan_paths:
    - "./packages/skills"
    - "./data/custom-skills"

memory:
  stm_window: 20
  ltm_auto_extract: true
  ltm_max_entries: 10000

rag:
  chunk_size: 512
  chunk_overlap: 64
  retrieval_top_k: 5
  embedder: local | api
  embedder_model: "Xenova/all-MiniLM-L6-v2"
```

---

## 九、开发路径建议

实施顺序按依赖关系排列：

1. **基础设施**: Monorepo 初始化、Fastify + SQLite 搭建、Auth 模块
2. **Skill 系统**: Manifest 规范 + Loader + Manager + 预设 Skill 开发
3. **Agent 引擎**: Chat Pipeline + 多模型适配 + Tool Executor + SSE 流
4. **记忆 & RAG**: 短期/长期记忆 + RAG Ingestion + 混合检索
5. **管理端 API**: Agent/Skill/KB/对话 CRUD
6. **管理端前端**: 页面逐开发（Dashboard → Agents → Skills → KB → Conversations → Settings）
7. **部署**: Docker + PM2 配置
