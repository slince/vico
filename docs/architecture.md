# Vico AI Agent 平台核心架构

## 系统全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端 (React 19)                             │
│  仪表盘 │ Agent管理 │ Skill管理 │ 知识库 │ 对话记录 │ LLM设置   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST + SSE (cookie session)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Hono API 层 (port 3001)                       │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  /auth/* │ │ /agents  │ │ /skills  │ │/knowledge│ │  /chat   │ │
│  │ better-  │ │  增删改查 │ │ 安装/卸载│ │ -bases   │ │  流式对话 │ │
│  │  auth    │ │  绑定管理 │ │ 启用/禁用│ │ 上传/索引│ │  SSE     │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Agent 引擎核心管道                               │
│                                                                     │
│  请求 → 加载Agent → 解析模型 → 构建系统提示词 → 组装工具            │
│       → AI SDK streamText → SSE流式响应 → 持久化 → 记忆更新         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   Skill 插件系统  │ │   记忆系统       │ │   知识库 (RAG)   │
│                  │ │                  │ │                  │
│ 文件系统发现     │ │ 短期记忆(STM)   │ │ 文本分块         │
│ manifest+prompt  │ │ 长期记忆(LTM)   │ │ 向量嵌入         │
│ +tools 加载      │ │ 事实自动提取    │ │ 混合搜索         │
│ 租户安装/绑定    │ │ 向量相似度检索  │ │ 去重合并         │
└──────────────────┘ └──────────────────┘ └──────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  模型层 (Model Registry)                            │
│  OpenAI │ Anthropic │ DeepSeek │ 通义千问 │ 自定义  (AI SDK适配)   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  数据层 (better-sqlite3 + Drizzle ORM)              │
│                                                                     │
│  业务表(12张): agents, skills, knowledge_bases, chunks,            │
│  conversations, messages, memory_entries, tool_call_logs, ...       │
│                                                                     │
│  认证表(7张): user, session, account, organization, member, ...    │
│              (由 better-auth 管理)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 一、Agent 引擎（core/agent）

### 1.1 聊天管道 (`pipeline.ts`)

**职责：** 将用户消息转换为 LLM 流式响应的全流程编排器。是整个系统的核心调度枢纽。

**执行流程（14 步）：**

```
用户消息
  │
  ├─ 1. 加载 Agent 配置（名称、system_prompt、temperature、max_tokens、rag_mode）
  ├─ 2. 解析模型 ── 获取默认模型配置（provider + api_key + model_name）
  ├─ 3. 创建 Provider ── 将 provider 字符串映射为 AI SDK Provider 函数
  │     Anthropic → createAnthropic() / 其他 → createOpenAI()
  ├─ 4. 创建/复用 Conversation ── 无 conversationId 则新建
  ├─ 5. 构建系统提示词（拼接顺序见下方）
  ├─ 6. 加载短期记忆 ── 从 STM 获取最近 N 轮对话
  ├─ 7. RAG 检索（如 rag_mode ≠ 'disabled'）── 混合搜索相关知识
  ├─ 8. 组装工具定义 ── 从 Agent 绑定的 Skill 获取工具列表
  ├─ 9. 调用 AI SDK streamText() ── maxSteps=10（最多 10 轮工具调用）
  ├─ 10. onStepFinish: 执行工具调用 → toolExecutor.execute()
  ├─ 11. 流式返回 SSE 事件: { type: 'text_delta' | 'done' | 'error' }
  ├─ 12. 持久化消息 ── 用户消息 + 助手回复写入 messages 表
  ├─ 13. 更新 STM 缓存 ── 将本轮对话推入短时记忆窗口
  └─ 14. 异步提取长期记忆 ── LTM 自动从对话中提取事实
```

**系统提示词拼接顺序：**
```
Agent 基础 system_prompt (来自配置)
  + 绑定的 Skill 提示词 (prompt.md)
  + 长期记忆事实 (LTM 检索结果, 格式化为 "关于用户的信息: ...")
  + RAG 上下文 (知识库检索结果, 格式化为 "参考知识: ...")
```

**关键设计：**
- `PipelineContext` 携带 `tenantId`、`agentId`、`userId`、`conversationId` 作为全链路上下文
- SSE 响应头携带 `X-Conversation-Id`，前端可据此关联后续对话
- 错误通过 `{ type: 'error', message }` SSE 事件返回，不中断流

### 1.2 工具执行器 (`tool-executor.ts`)

**职责：** Agent 调用工具时的运行时执行引擎。负责工具查找、参数解析、执行和日志记录。

**核心类：`ToolExecutor`**

| 能力 | 说明 |
|------|------|
| 工具缓存 | 按 agentId 缓存 `SkillTool[]` 映射，避免重复加载 |
| 参数解析 | AI SDK 可能传 JSON 字符串，自动 parse 为对象 |
| 执行调用 | `tool.handler(parsedArgs, context)`，context 包含 tenantId/agentId/userId/skillConfig |
| 审计日志 | 每次执行写入 `tool_call_logs` 表：工具名、参数、结果、状态(success/error)、耗时(ms) |

### 1.3 模型注册中心 (`model-registry.ts`)

**职责：** 管理租户级别的 LLM 模型配置。每个租户可配置多个模型，指定一个为默认。

**核心函数：**

| 函数 | 说明 |
|------|------|
| `listModels(tenantId)` | 列出租户所有模型 |
| `getDefaultModel(tenantId)` | 获取默认模型（`is_default=1`），无默认则取第一个 |
| `getModelById(tenantId, id)` | 按 ID 获取单个模型 |
| `addModel(tenantId, data)` | 新增模型配置 |
| `updateModel(tenantId, id, data)` | 更新模型配置 |
| `deleteModel(tenantId, id)` | 删除模型 |

**支持的 Provider：** OpenAI、Anthropic、DeepSeek、通义千问（Qwen）、自定义

---

## 二、Skill 插件系统（core/skill）

### 架构

```
文件系统扫描                    数据库管理
     │                             │
     ▼                             ▼
┌──────────────┐          ┌──────────────────┐
│  loader.ts   │  加载     │  manager.ts      │
│  发现 Skill   │ ──────→ │  安装/绑定/配置   │
│  读取 manifest│          │  生命周期管理    │
│  读取 prompt  │          └──────────────────┘
│  动态导入工具 │
└──────────────┘
```

### 2.1 Skill 加载器 (`loader.ts`)

**职责：** 从文件系统发现并加载 Skill 插件。

**Skill 目录结构：**
```
skills/<skill-name>/
├── manifest.json      # 元数据（名称、版本、参数定义、分类）
├── prompt.md          # 系统提示词片段（注入到 Agent prompt）
├── tools.ts           # 工具定义 + 处理函数（动态 import）
└── resources/         # 知识文档（可选，安装时自动索引到知识库）
```

**加载流程：**
1. `scanSkillDirs(scanPaths)` — 扫描配置的目录，找到所有含 `manifest.json` 的子目录
2. `loadManifest(skillDir)` — 解析 JSON 元数据
3. `loadPrompt(skillDir)` — 读取 markdown 提示词
4. `loadTools(skillDir)` — 动态 `import()` 执行 `tools.ts`，支持三种导出格式：
   - 函数：`export default (config) => SkillTool[]`
   - 数组：`export default [SkillTool, ...]`
   - 对象：`export default { tools: [SkillTool, ...] }`

### 2.2 Skill 管理器 (`manager.ts`)

**职责：** Skill 全生命周期管理。单例模式。

**核心方法：**

| 方法 | 说明 |
|------|------|
| `init()` | 启动时调用，扫描所有 Skill 目录，加载到内存注册表 `Map<name, SkillRegistryEntry>` |
| `getAllManifests()` | 获取所有已发现 Skill 的清单 |
| `installSkill(tenantId, name, config?)` | 为租户安装 Skill，写入 `installed_skills` 表。安装时自动将 `resources/` 目录内容索引为知识库 |
| `uninstallSkill(tenantId, name)` | 卸载 Skill，级联删除所有 `agent_skills` 绑定 |
| `toggleSkill(tenantId, name, enabled)` | 启用/禁用已安装的 Skill |
| `updateSkillConfig(tenantId, name, config)` | 更新 Skill 的配置 JSON |
| `getToolsForAgent(agentId)` | 获取 Agent 绑定的所有 Skill 工具（含 handler） |
| `getToolDefsForAgent(agentId)` | 获取工具定义（仅 definition，用于传给 LLM） |
| `getPromptForAgent(agentId)` | 拼接 Agent 绑定的所有 Skill 的 prompt.md |
| `registerToAgent(agentId, skillName, config?)` | 将 Skill 绑定到 Agent |
| `unregisterFromAgent(agentId, skillName)` | 解除绑定 |

### 2.3 核心类型 (`types.ts`)

```typescript
SkillManifest {
  name: string;                    // 唯一标识
  displayName: string;             // 显示名称
  version: string;
  description: string;
  category: string;                // 分类
  parameters: Record<string, SkillParameter>;  // 可配置参数
}

SkillTool {
  definition: SkillToolDef;        // 工具定义（name, description, JSON Schema parameters）
  handler: (args, context) => Promise<any>;  // 工具执行函数
}

ToolContext {
  tenantId: string;
  agentId: string;
  skillConfig: Record<string, any>;  // 安装时的配置
  userId: string;
}
```

---

## 三、记忆系统（core/memory）

### 3.1 短期记忆 (`short-term.ts`)

**职责：** 维护每个对话的最近消息滑动窗口，加速对话上下文注入。

**实现：** `Map<conversationId, ShortTermMessage[]>` 内存缓存

**参数：** `stm_window: 20`（默认保存最近 20 轮 = 40 条消息）

**流程：**
1. 先查内存缓存
2. 缓存未命中时回退到 DB 查询（`messages` 表按 `created_at DESC` 取最近 N 条）
3. 新消息到达时追加到缓存，超出窗口则淘汰最旧条目
4. 返回时反转为时间正序

### 3.2 长期记忆 (`long-term.ts`)

**职责：** 向量化的持久记忆存储，支持从对话中自动提取用户事实。

**数据模型（`memory_entries` 表）：**

| 字段 | 说明 |
|------|------|
| content | 记忆文本 |
| embedding | Float32Array(384) 向量，以 Blob 存储 |
| type | 类型：`fact`（事实）/ `preference`（偏好）/ `summary`（摘要）/ `decision`（决策） |
| importance | 重要度 0~1 |
| expires_at | 过期时间（可空） |

**核心方法：**

| 方法 | 说明 |
|------|------|
| `store(tenantId, userId, content, type?, importance?)` | 嵌入文本后存储 |
| `retrieve(tenantId, userId, query, topK=5)` | 余弦相似度搜索最近 500 条，返回 topK |
| `extractAndStore(tenantId, userId, messages)` | 正则匹配用户陈述事实（我喜欢/偏好/习惯/想要/希望/我是...），自动提取并存储 |

**事实提取规则（正则模式）：**
- `我(喜欢|偏好|习惯|想要|希望)...` → type: `preference`
- `(以后|下次|将来)...` → type: `preference`
- `我(是|叫|在|做)...` → type: `fact`

**自动清理：** 条目数超过 `ltm_max_entries`(10000) 时删除最早的 10%。

### 3.3 RAG 检索增强生成 (`rag.ts`)

**职责：** 知识库文档索引和混合搜索，为 Agent 对话提供领域知识增强。

**文档索引流程：**
```
上传文件(.pdf/.txt/.md/.csv)
  → 解析文本
  → splitText() 分块（chunk_size=512, overlap=64）
  → embedder.embed() 向量化
  → 存储到 chunks 表
```

**混合搜索策略（70% 语义 + 30% 关键词）：**
```
用户查询
  ├─ semanticSearch(): 向量余弦相似度 → topK 结果
  ├─ keywordSearch(): 关键词匹配率评分 → topK 结果
  └─ 加权合并: 0.7 × semanticScore + 0.3 × keywordScore → 去重排序 → topK
```

**文件类型支持：**
| 类型 | 解析方式 |
|------|---------|
| `.md` / `.txt` | 直接读取 |
| `.pdf` | `pdf-parse` 库解析 |
| `.csv` | 直接读取 |

### 3.4 嵌入器 (`embedder.ts`)

**职责：** 文本向量化，支持本地和远程两种模式。

**双模式设计：**

| 模式 | 引擎 | 维度 | 说明 |
|------|------|------|------|
| `local` | Transformers.js (`Xenova/all-MiniLM-L6-v2`) | 384 | 懒加载，失败时降级为哈希嵌入 |
| `api` | OpenAI `text-embedding-3-small` | 1536 | 使用第一个 OpenAI 模型的 API key |

**降级方案：** 本地模型加载失败时，使用 token 哈希 + 归一化生成替代向量，确保系统可用。

---

## 四、认证系统（auth/）

### 架构

基于 **better-auth** 框架，使用 Session Cookie 替代传统 JWT Token。

```
用户请求
  → better-auth handler (/api/auth/*): 注册、登录、登出、Session 管理
  → Session 中间件: 每次请求调用 auth.api.getSession() 解析 Cookie
  → 注入 user + session 到 Hono 上下文
  → Auth Guard (/api/v1/*): 校验 session 存在且 activeOrganizationId 有效
  → getAuthContext(c): 提取 { tenantId, userId }
```

**多租户隔离：**
- 通过 `organization` 插件实现
- `session.activeOrganizationId` 作为 `tenantId`
- 所有业务查询按 `tenant_id` 过滤

**默认账户：** `admin` / `admin123`（首次运行时通过 `seed.ts` 自动创建）

---

## 五、API 路由层

### 路由注册架构

```
Hono App
├── CORS (*)
├── Rate Limiter (100 req/min/IP)
├── GET /health
├── Session 中间件 (跳过 /health 和 /api/auth/*)
├── /api/auth/* → auth.handler() (better-auth 原生路由)
└── /api/v1/*
    ├── Auth Guard (校验 session + activeOrganizationId)
    └── 业务路由注册
        ├── auth.ts        → GET /api/v1/auth/me
        ├── agents.ts      → CRUD + 绑定管理
        ├── skills.ts      → 安装/卸载/启禁用/配置
        ├── knowledge.ts   → 知识库 CRUD + 文件上传
        ├── conversations.ts → 对话列表/详情/删除
        ├── models.ts      → LLM 模型配置 CRUD
        ├── dashboard.ts   → 统计数据聚合
        └── chat.ts        → SSE 流式对话
```

### 中间件层序

| 序号 | 中间件 | 作用 |
|------|--------|------|
| 1 | CORS | 允许所有来源，携带 Cookie |
| 2 | Rate Limiter | 内存计数器，超限返回 429 |
| 3 | Session | 解析 Cookie 注入 `user` + `session` |
| 4 | Auth Guard | `/api/v1/*` 路由的 Session 有效性校验 |

---

## 六、数据库设计

### 业务表（12 张）

| 表名 | 核心字段 | 职责 |
|------|---------|------|
| `model_configs` | provider, model_name, api_key_encrypted, base_url, is_default | 租户级 LLM 模型配置 |
| `agents` | name, system_prompt, model_id, temperature, max_tokens, rag_mode, enabled | Agent 定义 |
| `installed_skills` | skill_name, display_name, version, config(JSON), enabled | 租户级 Skill 安装记录。UNIQUE(tenant_id, skill_name) |
| `agent_skills` | agent_id, skill_name, config(JSON) | M:N Agent-Skill 绑定。复合主键 |
| `knowledge_bases` | name, description, source, skill_name, chunk_count | 知识库容器 |
| `chunks` | kb_id, content, embedding(Blob), metadata(JSON) | 向量文档块。FK 级联删除 |
| `agent_knowledge_bases` | agent_id, kb_id, mode | M:N Agent-KB 绑定。复合主键 |
| `conversations` | agent_id, user_id, title, model_name, message_count, total_tokens | 对话会话 |
| `messages` | conversation_id, role, content, tool_calls(JSON), token_usage | 对话消息 |
| `memory_entries` | user_id, type, content, embedding(Blob), importance, expires_at | 长期记忆条目 |
| `tool_call_logs` | agent_id, conversation_id, message_id, tool_name, args, result, status, duration_ms | 工具调用审计日志 |
| `token_usage_logs` | agent_id, model_name, prompt_tokens, completion_tokens | Token 用量记录 |

### 认证表（7 张，由 better-auth 管理）

| 表名 | 职责 |
|------|------|
| `user` | 用户身份（email, username） |
| `session` | Session 管理（token, expiresAt, activeOrganizationId） |
| `account` | OAuth + 密码凭证 |
| `verification` | 邮箱验证 token |
| `organization` | 多租户组织 |
| `member` | 组织成员关系 + 角色 |
| `invitation` | 组织邀请 |

---

## 七、前端架构

### 页面清单与功能矩阵

| 页面 | 路由 | 功能 |
|------|------|------|
| 登录 | `/login` | better-auth 用户名密码登录 |
| 仪表盘 | `/dashboard` | 5 项统计卡片、Token 趋势图、最近对话列表（30s 轮询刷新） |
| Agent 管理 | `/agents` | 卡片网格展示、创建/删除 Agent、AlertDialog 确认删除 |
| Agent 详情 | `/agents/:id` | 4 Tab：配置（自动保存）、Skill 绑定、知识库绑定、测试对话（SSE 流式） |
| Skill 管理 | `/skills` | 安装/卸载/启禁用 Skill、参数配置 |
| 知识库 | `/knowledge` | 新建/删除知识库、上传文档（pdf/txt/md/csv）、查看文档块 |
| 知识库详情 | `/knowledge/:id` | 文档块列表、删除单个块 |
| 对话记录 | `/conversations` | 搜索+过滤表格、查看详情入口 |
| 对话详情 | `/conversations/:id` | 消息气泡列表（用户/AI/系统三角色）、工具调用展开 |
| LLM 设置 | `/settings` | 添加/删除模型、设为默认、Provider 预设（OpenAI/Anthropic/DeepSeek/通义千问） |

### 数据流架构

```
React Query (TanStack Query 5)
  ├─ useQuery: 自动缓存、后台刷新、30s staleTime
  ├─ useMutation: 乐观更新、invalidateQueries 刷新列表
  └─ streamChat: SSE ReadableStream 手动解析

Auth (better-auth React Client)
  ├─ useAuth() hook: user, session, login(), logout(), isAuthenticated, tenantId
  └─ credentials: 'include' Cookie 自动携带
```

### 组件状态覆盖标准

每个数据驱动的页面必须覆盖四种状态：**加载态(Skeleton)** → **空状态(Empty)** → **错误态(Fallback)** → **正常态(Data)**。见 `docs/react-best-practices.md`。

---

## 八、配置体系

### 服务端配置 (`server.config.yaml`)

```yaml
server:
  port: 3001
  deploy_mode: private          # 'private' 或 'saas'

auth:
  session_expiry_days: 7

database:
  path: ../data/vico.db

skills:
  scan_paths:                   # Skill 扫描目录
    - ../../skills
    - ../data/custom-skills

memory:
  stm_window: 20                # 短期记忆窗口（对话轮数）
  ltm_auto_extract: true        # 自动提取长期记忆
  ltm_max_entries: 10000        # 长期记忆条目上限

rag:
  chunk_size: 512               # 文档分块大小
  chunk_overlap: 64             # 分块重叠
  retrieval_top_k: 5            # 检索返回数
  embedder: local               # 'local' 或 'api'
  embedder_model: Xenova/all-MiniLM-L6-v2

llm:
  models: []                    # 可通过 UI 动态管理，此处预留静态配置
```

支持 `${ENV_VAR}` 环境变量插值。

---

## 九、关键设计模式

| 模式 | 应用场景 |
|------|---------|
| **单例模式** | `skillManager`、`toolExecutor`、`shortTermMemory`、`longTermMemory`、`ragManager`、`getDb()` |
| **适配器模式** | 模型 Provider 适配（Anthropic/OpenAI → AI SDK 统一接口）、嵌入器双模式 |
| **管道模式** | 聊天执行 pipeline 串联 14 个步骤 |
| **中间件链** | Hono 中间件层序：CORS → 限流 → Session → Auth Guard |
| **钩子模式** | Skill 工具通过 `onStepFinish` 钩子注入到 AI SDK streamText |
| **仓库模式** | Drizzle ORM 提供类型安全的数据库查询，替代原生 SQL |

---

## 十、部署模式

| 模式 | 说明 |
|------|------|
| `private` | 单租户模式，所有数据属于唯一组织 |
| `saas` | 多租户模式，通过 `organization` 插件 + `tenant_id` 隔离 |
