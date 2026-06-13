# Vico AI Agent 管理平台 — 技术文档

> 版本: 0.1.0 | 最后更新: 2026-06-13

---

## 1. 项目概述

Vico 是一个面向中小企业的 AI Agent 管理平台，核心理念是「配置 + 即插即用 Skill」。平台提供可视化的 Agent 编排界面，支持多模型 LLM 接入、文件系统 Skill 插件、双层记忆管理和 RAG 知识库，让非技术用户也能构建自己的 AI 助手。

### 目标用户

- 中小企业管理者：通过管理后台配置 Agent、绑定 Skill、上传知识库
- 开发者：通过 Skill 插件规范开发自定义工具，扩展 Agent 能力

### 核心特性

| 特性 | 说明 |
|------|------|
| 多模型支持 | OpenAI / Anthropic / DeepSeek / 通义千问 / 自定义 OpenAI 兼容接口 |
| Agent 编排 | 可视化创建 Agent，配置 system prompt、模型、温度等参数 |
| Skill 即插即用 | 文件系统 Skill 包（manifest + prompt + tools），安装即可绑定到 Agent |
| 双层记忆 | 短期记忆（会话窗口）+ 长期记忆（向量检索 + 事实提取）|
| RAG 知识库 | 文档上传 → 自动分块 → 向量化 → 混合搜索（语义 70% + 关键词 30%）|
| 多 Agent 协作 | Supervisor + Delegation 模式团队编排 |
| 多租户 | 基于 better-auth organization 的数据隔离 |
| SSE 流式响应 | 实时文本流输出，支持工具调用追踪 |

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    前端 (React 19 + Vite 6)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ 管理后台  │ │ Chat 面板 │ │ 配置页面  │             │
│  └──────────┘ └────┬─────┘ └──────────┘             │
│                    │ SSE Stream                      │
└────────────────────┼────────────────────────────────┘
                     │ HTTP/SSE (Vite Proxy)
┌────────────────────┼────────────────────────────────┐
│              后端 (Hono 4 + TypeScript)              │
│                    │                                  │
│  ┌─────────────────┴──────────────────┐              │
│  │           API 路由层                │              │
│  │  auth | agents | chat | skills     │              │
│  │  conversations | knowledge | models │             │
│  │  dashboard | teams                  │              │
│  └─────────────────┬──────────────────┘              │
│                    │                                  │
│  ┌─────────────────┴──────────────────┐              │
│  │          Agent 引擎层               │              │
│  │  ┌──────────────────────────────┐  │              │
│  │  │  Pipeline（Legacy / Mastra）  │  │              │
│  │  └──────────────────────────────┘  │              │
│  │  ┌──────────────────────────────┐  │              │
│  │  │  Orchestrator（团队编排）     │  │              │
│  │  └──────────────────────────────┘  │              │
│  └─────────────────┬──────────────────┘              │
│                    │                                  │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────┐ ┌─────────┐  │
│  │Skill │ │Memory│ │  RAG   │ │Model │ │  Auth   │  │
│  │Manager│ │System│ │Manager │ │Registry│ │(better-│  │
│  │      │ │      │ │        │ │      │ │ auth)   │  │
│  └──────┘ └──────┘ └────────┘ └──────┘ └─────────┘  │
│                    │                                  │
│           ┌────────┴────────┐                        │
│           │   SQLite + WAL  │                        │
│           │  (better-sqlite3)│                       │
│           └─────────────────┘                        │
└─────────────────────────────────────────────────────┘
```

### 技术栈总览

| 层 | 技术 | 版本 |
|-------|-----------|-------|
| 运行时 | Node.js + TypeScript ESM | ES2022 |
| 后端框架 | Hono | 4.x |
| Agent 框架 | Vercel AI SDK (`ai`) | 4.x |
| 数据库 | better-sqlite3 (WAL) + Drizzle ORM | - |
| 认证 | better-auth | 1.6+ |
| 嵌入模型 | Transformers.js (本地) / OpenAI API | - |
| 前端框架 | React | 19.x |
| 构建工具 | Vite | 6.x |
| 样式 | Tailwind CSS | 4.x |
| UI 组件 | shadcn/ui (radix-rhea) | - |
| 数据获取 | TanStack Query | 5.x |
| 校验 | Zod | - |
| 包管理 | pnpm + Turborepo | 9.x |

---

## 3. 功能模块详解

### 3.1 Agent 引擎

#### 3.1.1 聊天管道（Chat Pipeline）

Agent 执行分为两种引擎模式，通过 `server.config.yaml` 中的 `agent_engine` 字段切换：

```
chat.ts (API)
  └─> pipeline.ts: runChatPipeline()
        ├─ engine == 'mastra' → mastra/agent-factory.ts
        └─ engine == 'legacy' → pipeline.ts: runPipeline()
```

**14 步执行流程：**

1. **加载 Agent 配置** — 从 `agents` 表获取 system_prompt、model_id、temperature 等
2. **解析模型** — 从 `model_configs` 表获取默认模型，通过 provider 路由创建 AI SDK LanguageModel
3. **创建/复用会话** — 新建或复用 `conversations` 记录
4. **构建 Skill 提示词** — 从 `agent_skills` 关联表获取绑定 Skill 的 prompt.md 片段
5. **检索长期记忆** — 向量嵌入查询 + 余弦相似度排序，取 top-K
6. **RAG 检索** — 若 agent.rag_mode ≠ 'disabled'，查询关联知识库的混合搜索结果
7. **读取短期记忆** — 从内存缓存获取对话窗口内的历史消息
8. **组装系统提示词** — 拼接 Agent prompt + Skill prompt + LTM + RAG + Working Memory + Observation
9. **获取工具定义** — 将绑定 Skill 的 tools.ts 导出转换为 AI SDK tool 格式
10. **构建消息列表** — 短期记忆历史消息 + 当前用户消息
11. **执行 streamText** — AI SDK v4 `streamText()`，maxSteps=10
12. **SSE 流式输出** — `text_delta` 事件逐 token 推送，`done` 事件结束
13. **持久化消息** — 用户消息和 AI 回复写入 `messages` 表
14. **更新记忆** — STM 缓存更新、LTM 事实提取（异步）、WorkingMemory 提取、ObservationalMemory 压缩检查

#### 3.1.2 模型注册中心

**文件:** `src/agent/model-registry.ts`

- 管理 `model_configs` 表 CRUD
- Provider 路由逻辑:
  - `anthropic` → `@ai-sdk/anthropic` 的 `createAnthropic()`
  - `openai`/`deepseek`/`qwen`/`custom` → `@ai-sdk/openai` 的 `createOpenAI()`（OpenAI 兼容协议）
- API Key 支持 `${ENV_VAR}` 环境变量插值
- 通过管理后台 `/settings` 页面可视化配置

#### 3.1.3 双引擎架构

| 特性 | Legacy 引擎 | Enhanced (Mastra) 引擎 |
|------|------------|----------------------|
| 代码位置 | `pipeline.ts:runPipeline()` | `mastra/agent-factory.ts:createMastraAgent()` |
| 模型解析 | 内联 `resolveModelProvider()` | `model-bridge.ts` |
| Skill 集成 | `skillManager.getToolDefsForAgent()` + JSON Schema → Zod | `skill-bridge.ts` 直接输出 AI SDK 格式 |
| RAG | 内联检索逻辑 | `rag-bridge.ts` 封装为独立模块 |
| 审计日志 | ❌ | ✅ `audit-logger.ts` → `tool_call_logs` |
| Token 统计 | ❌ | ✅ `token-tracker.ts` → `token_usage_logs` |
| 消息持久化 | 内联 INSERT | `message-persister.ts` 统一处理 |
| Working Memory | ❌ | ✅ 用户偏好/事实提取 |
| Observational Memory | ❌ | ✅ 长对话摘要压缩 |
| 引擎切换 | 固定 | 运行时 fallback（增强引擎失败 → 降级 legacy） |

---

### 3.2 Skill 插件系统

#### 3.2.1 Skill 文件结构

```
skills/<name>/
├── manifest.json    # 元数据：name, version, parameters, category
├── prompt.md        # 系统提示词片段（注入 Agent system prompt）
├── tools.ts         # 导出 SkillTool[]（工具定义 + 执行函数）
└── resources/       # 知识文档（安装时自动索引到知识库）
```

#### 3.2.2 Skill 生命周期

```
文件系统扫描 → 加载 manifest.json + prompt.md + tools.ts
  → SkillManager.registry 注册
    → installed_skills 表（租户级安装，可启用/禁用）
      → agent_skills 表（Agent 级绑定）
        → 运行时：getToolsForAgent() + getPromptForAgent()
```

#### 3.2.3 tools.ts 导出格式

```typescript
// 方式 1: 直接导出数组（兼容旧版）
export default [
  { definition: { name, description, parameters }, handler: async (args, ctx) => {...} }
];

// 方式 2: 导出工厂函数
export default (config) => [
  { definition: {...}, handler: async (args, ctx) => {...} }
];

// 方式 3: 导出对象
export default { tools: [...] };
```

#### 3.2.4 内置 Skill 示例

| Skill | 类别 | 工具 | 功能 |
|-------|------|------|------|
| `employee-mgmt` | HR | 4 个 | 员工列表查询、考勤记录、请假申请 |
| `quotation-generator` | 工程 | 4 个 | 材料价格查询、人工成本、报价计算、文档生成 |

---

### 3.3 记忆系统

```
┌───────────────────────────────────────────────┐
│              记忆系统四层架构                    │
├───────┬──────────┬──────────┬─────────────────┤
│ 短期   │  长期    │  工作    │   观察           │
│(STM)  │  (LTM)   │(Working) │(Observational)  │
├───────┼──────────┼──────────┼─────────────────┤
│ 内存   │ SQLite+  │ SQLite   │ SQLite          │
│ Map    │ 向量嵌入  │ 精确匹配  │ 规则拼接         │
│ FIFO   │ 余弦相似度│ 正则提取  │ 长对话压缩       │
│ 20轮   │ Top-K    │ 去重更新  │ 上下文注入       │
└───────┴──────────┴──────────┴─────────────────┘
```

#### 3.3.1 短期记忆 (STM)

- **存储:** 内存 `Map<conversationId, ShortTermMessage[]>`
- **窗口:** `stm_window * 2` 条消息（默认 40 条）
- **策略:** 先进先出（FIFO），超限自动淘汰最旧消息
- **降级:** 缓存未命中时回退查询 `messages` 表

#### 3.3.2 长期记忆 (LTM)

- **存储:** `memory_entries` 表，type='fact'
- **写入:** 正则匹配提取事实（`我喜欢...`、`我是...`），向量嵌入后存储
- **检索:** 查询嵌入 + 余弦相似度排序（加载最近 500 条到内存计算）
- **去重:** 无
- **淘汰:** 超过 `ltm_max_entries`(10000) 时删除最旧 10%

#### 3.3.3 工作记忆 (Working Memory)

- **存储:** `memory_entries` 表，type='working'
- **提取:** 正则匹配用户偏好/行为模式（`我喜欢...`、`以后...`、`我是...`）
- **检索:** `searchByType()` 精确类型匹配，按 importance 降序
- **去重:** 内容前 120 字符匹配即更新（`upsertByContent`）

#### 3.3.4 观察记忆 (Observational Memory)

- **存储:** `memory_entries` 表，type='observation'
- **触发:** 对话消息数 > `stm_window * 2` 条
- **方法:** 拼接最近消息（用户+助手角色，每条截断 200 字符）
- **检索:** 按 conversation_id LIKE 匹配

#### 3.3.5 嵌入模型

| 后端 | 模型 | 维度 | 适用场景 |
|------|------|------|----------|
| 本地 (Transformers.js) | Xenova/all-MiniLM-L6-v2 | 384 | 开发/离线/隐私 |
| API (OpenAI) | text-embedding-3-small | 1536 | 生产/高精度 |

---

### 3.4 RAG 知识库

```
文档上传 → 文件类型检测（.pdf/.txt/.md/.csv）
  → 文本提取（pdf-parse / 直接读取）
    → 分块（512 chars, 64 overlap，段落感知）
      → 向量化（embedder）
        → 存储到 chunks 表
          → 绑定到 Agent（agent_knowledge_bases）
            → 检索时混合搜索
```

#### 混合搜索策略

- **语义搜索（70%权重）:** 查询向量化 → 加载最近 2000 chunks → 余弦相似度排序
- **关键词搜索（30%权重）:** 分词 → 大小写不敏感全文匹配 → 命中率评分
- **合并:** 去重后按加权分数排序，取 top-K

#### 分块策略

```
优先级 1: 段落边界（\n\n 分割）
优先级 2: chunk_size=512 字符内自然段落合并
优先级 3: 超长段落按空格分词切分，chunk_overlap=64 滑动窗口
```

---

### 3.5 多 Agent 协作（团队编排）

#### 架构模式：Supervisor + Delegation

```
用户消息
  │
  ▼
Supervisor Agent（协调者）
  │
  ├─► delegate_to_agent_A("分析数据")
  │     └─► Sub-Agent A 独立执行（完整 pipeline）
  │           └─► 返回结果文本
  │
  ├─► delegate_to_agent_B("生成报告")
  │     └─► Sub-Agent B 独立执行
  │           └─► 返回结果文本
  │
  └─► 整合所有结果 → 最终回复
```

#### 关键设计

- **委派工具:** 每个成员生成 `delegate_to_<agentId>` 工具，Supervisor 通过 tool call 委派
- **子 Agent 执行:** 进程内 `streamText()`，收集完整文本后返回
- **SSE 事件:** `delegation_start` / `delegation_end` 通知前端子 Agent 工作状态
- **路由策略:** 当前仅支持 `supervisor` 模式，预留 `routing_strategy` 扩展字段

---

### 3.6 认证与多租户

#### 认证流程

```
用户登录(admin/admin123)
  → better-auth username 插件
    → scrypt 密码验证
      → Session Cookie (7 天过期)
        → 所有 API 请求附带 Cookie
          → Session 中间件注入 user/session 到 Hono Context
            → getAuthContext(c) 提取 { tenantId, userId }
              → 所有数据查询按 tenant_id 过滤
```

#### 多租户模型

- 租户 = better-auth `organization`
- 用户注册时自动创建组织（单租户部署）或加入已有组织（SaaS 部署）
- `deploy_mode` 配置：`private`（单组织）/ `saas`（多组织）
- 所有业务表带 `tenant_id` 外键，查询强制过滤

#### 默认数据

| 实体 | 值 |
|------|-----|
| 组织 | 默认租户 (slug: default) |
| 管理员 | admin / admin123 |
| 邮箱 | admin@vico.local |

---

### 3.7 管理后台

#### 页面路由

| 路由 | 页面 | 功能 |
|------|------|------|
| `/login` | 登录 | 用户名密码登录 |
| `/dashboard` | 仪表盘 | 5 个统计卡片 + Token 趋势图 + 最近对话 |
| `/agents` | Agent 列表 | 创建/删除 Agent，卡片展示 |
| `/agents/:id` | Agent 详情 | 4 个 Tab：配置/技能/知识库/测试对话 |
| `/teams` | 团队列表 | 创建/删除团队 |
| `/teams/:id` | 团队详情 | 3 个 Tab：概览/成员/测试对话 |
| `/skills` | 技能管理 | 安装/卸载/启用/禁用 Skill |
| `/knowledge` | 知识库列表 | 创建/上传/删除知识库 |
| `/knowledge/:id` | 知识库详情 | 分块列表查看/删除 |
| `/conversations` | 对话历史 | 搜索过滤表格 |
| `/conversations/:id` | 对话详情 | 消息气泡 + 工具调用展开 |
| `/settings` | 系统设置 | LLM 模型配置管理 |

#### 前端架构

- **数据获取:** TanStack Query v5（`staleTime: 30s`，Dashboard 30s 轮询）
- **SSE 流式:** 原生 `fetch` + `ReadableStream` + line-by-line 解析
- **组件模式:** 页面组件负责数据获取，子组件通过 props 接收
- **状态覆盖:** 每个数据驱动组件处理 Loading(Skeleton) / Empty / Error / Normal
- **防抖保存:** 文本类配置 300ms 防抖，滑块类 `onValueCommit`
- **认证守卫:** `ProtectedRoute` 组件，未认证重定向 `/login`

---

## 4. 数据库设计

### 4.1 ER 图（核心关系）

```
organization (租户)
  │
  ├── model_configs (LLM 模型)
  │     └── agents (Agent 定义)
  │           ├── agent_skills (Agent ↔ Skill 绑定)
  │           ├── agent_knowledge_bases (Agent ↔ 知识库)
  │           ├── agentTeamMembers (团队成员)
  │           └── conversations (会话)
  │                 └── messages (消息)
  │
  ├── installed_skills (已安装 Skill)
  ├── knowledge_bases (知识库)
  │     └── chunks (文档分块 + 向量)
  ├── memory_entries (记忆条目)
  ├── tool_call_logs (工具调用日志)
  ├── token_usage_logs (Token 用量)
  └── agentTeams (Agent 团队)

user (用户)
  ├── member (组织成员)
  │     └── organization
  ├── session (会话)
  └── account (凭据)
```

### 4.2 业务表清单（12 张）

| 表 | 主键 | 核心字段 | 用途 |
|----|------|----------|------|
| `model_configs` | id (uuid) | provider, model_name, api_key_encrypted, base_url, is_default | LLM 模型配置 |
| `agents` | id (uuid) | name, system_prompt, model_id, temperature, max_tokens, rag_mode | Agent 定义 |
| `installed_skills` | id (uuid) | skill_name, display_name, version, config, enabled | 租户级 Skill 安装 |
| `agent_skills` | (agent_id, skill_name) | config | Agent ↔ Skill 绑定 |
| `knowledge_bases` | id (uuid) | name, source, skill_name, chunk_count | 知识库 |
| `chunks` | id (uuid) | kb_id (FK), content, embedding (BLOB), metadata | 文档分块向量 |
| `agent_knowledge_bases` | (agent_id, kb_id) | mode | Agent ↔ KB 绑定 |
| `conversations` | id (uuid) | agent_id, user_id, title, message_count, total_tokens | 对话会话 |
| `messages` | id (uuid) | conversation_id (FK), role, content, tool_calls, token_usage | 消息记录 |
| `memory_entries` | id (uuid) | type, content, embedding (BLOB), importance | 记忆条目 |
| `tool_call_logs` | id (uuid) | tool_name, args, result, status, duration_ms | 工具调用审计 |
| `token_usage_logs` | id (uuid) | model_name, prompt_tokens, completion_tokens | Token 用量统计 |
| `agentTeams` | id (uuid) | name, routing_strategy, supervisor_agent_id | 团队定义 |
| `agentTeamMembers` | id (uuid) | team_id (FK), agent_id (FK), role | 团队成员 |

### 4.3 认证表（7 张，better-auth 管理）

`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`

---

## 5. API 设计

### 5.1 基础规范

- 前缀: `/api/v1`
- 认证: Session Cookie（`credentials: 'include'`）
- 响应格式: JSON
- 流式: SSE (`text/event-stream`)

### 5.2 端点清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 当前用户信息 |
| GET | `/api/v1/agents` | Agent 列表 |
| POST | `/api/v1/agents` | 创建 Agent |
| GET | `/api/v1/agents/:id` | Agent 详情 |
| PUT | `/api/v1/agents/:id` | 更新 Agent |
| DELETE | `/api/v1/agents/:id` | 删除 Agent |
| PUT | `/api/v1/agents/:id/skills` | 更新 Agent Skill 绑定 |
| PUT | `/api/v1/agents/:id/knowledge` | 更新 Agent 知识库绑定 |
| POST | `/api/v1/chat` | 单 Agent 对话（SSE）|
| GET | `/api/v1/conversations` | 对话列表 |
| GET | `/api/v1/conversations/:id` | 对话详情（含消息）|
| GET | `/api/v1/skills` | 已安装 Skill 列表 |
| POST | `/api/v1/skills/install` | 安装 Skill |
| DELETE | `/api/v1/skills/:name` | 卸载 Skill |
| POST | `/api/v1/skills/:name/toggle` | 启用/禁用 Skill |
| GET | `/api/v1/knowledge-bases` | 知识库列表 |
| POST | `/api/v1/knowledge-bases` | 创建知识库 |
| DELETE | `/api/v1/knowledge-bases/:id` | 删除知识库 |
| POST | `/api/v1/knowledge-bases/:id/upload` | 上传文档 |
| DELETE | `/api/v1/knowledge-bases/:id/chunks/:chunkId` | 删除分块 |
| GET | `/api/v1/models` | 模型列表 |
| POST | `/api/v1/models` | 添加模型 |
| PUT | `/api/v1/models/:id` | 更新模型 |
| DELETE | `/api/v1/models/:id` | 删除模型 |
| GET | `/api/v1/teams` | 团队列表 |
| POST | `/api/v1/teams` | 创建团队 |
| GET | `/api/v1/teams/:id` | 团队详情 |
| PATCH | `/api/v1/teams/:id` | 更新团队 |
| DELETE | `/api/v1/teams/:id` | 删除团队 |
| PUT | `/api/v1/teams/:id/members` | 更新团队成员 |
| POST | `/api/v1/teams/:id/chat` | 团队对话（SSE）|
| GET | `/api/v1/dashboard/stats` | 仪表盘统计 |

---

## 6. 配置系统

### 配置文件: `packages/server/server.config.yaml`

```yaml
server:
  port: 3001
  deploy_mode: private        # private | saas
  agent_engine: legacy        # legacy | mastra

auth:
  session_expiry_days: 7

database:
  path: "./data/vico.db"

skills:
  scan_paths:
    - "../skills"             # 内置 Skill
    - "./data/custom-skills"  # 用户自定义 Skill

memory:
  stm_window: 20              # 短期记忆轮数
  ltm_auto_extract: true      # 自动提取长期记忆
  ltm_max_entries: 10000      # LTM 最大条目数

rag:
  chunk_size: 512
  chunk_overlap: 64
  retrieval_top_k: 5
  embedder: local             # local | api
  embedder_model: "Xenova/all-MiniLM-L6-v2"

llm:
  models: []                  # 模型列表，支持 ${ENV_VAR} 插值
```

---

## 7. 部署架构

### 开发环境

```
pnpm dev
  ├─> @vico/server (tsx watch, port 3001)
  └─> @vico/web (Vite dev server, port 5173, proxy /api → 3001)
```

### 单机部署（推荐）

```
Node.js 进程 (Hono)
  ├─ SQLite 文件数据库 (WAL 模式)
  ├─ 本地嵌入模型 (Transformers.js, ~100MB ONNX 模型文件)
  └─ Vite 构建的静态前端 (可 nginx 反向代理或直接 serve)
```

### 环境要求

- Node.js >= 20
- pnpm >= 9
- 磁盘空间 >= 2GB（模型文件 + 数据库）
- 可选：OpenAI API Key（用于 LLM 调用或 API 嵌入模式）

---

## 8. 项目目录结构

```
vico/
├── packages/
│   ├── server/                    # 后端
│   │   ├── server.config.yaml     # 配置文件
│   │   └── src/
│   │       ├── index.ts           # 入口，Hono 启动
│   │       ├── config.ts          # 配置加载器
│   │       ├── api/               # 路由处理（11 个模块）
│   │       ├── agent/             # Agent 引擎核心
│   │       │   ├── pipeline.ts    # Legacy + 引擎选择器
│   │       │   ├── orchestrator.ts # 团队编排
│   │       │   ├── model-registry.ts
│   │       │   ├── tool-executor.ts
│   │       │   ├── mastra/        # 增强引擎
│   │       │   │   ├── agent-factory.ts
│   │       │   │   ├── storage.ts
│   │       │   │   ├── bridges/   # 4 个桥接模块
│   │       │   │   └── processors/ # 3 个处理器
│   │       │   └── memory/        # Phase 3 记忆升级
│   │       ├── skill/             # Skill 插件系统
│   │       ├── memory/            # 记忆/RAG/嵌入
│   │       ├── auth/              # 认证配置
│   │       └── db/                # 数据库 ORM + Schema
│   ├── web/                       # 前端
│   │   └── src/
│   │       ├── main.tsx           # 入口
│   │       ├── router.tsx         # 路由定义
│   │       ├── api/               # API 客户端
│   │       ├── hooks/             # 自定义 Hook
│   │       ├── components/        # UI 组件
│   │       │   ├── layout/        # 布局组件
│   │       │   └── ui/            # shadcn/ui 组件库
│   │       ├── pages-new/         # 当前页面
│   │       └── pages/             # 旧版页面 (/old/*)
│   └── skills/                    # 内置 Skill 包
└── docs/                          # 文档
    ├── architecture.md
    ├── ts-server-best-practices.md
    ├── react-best-practices.md
    ├── ui-components.md
    ├── feature/                   # 功能模块文档（本目录）
    └── insights/                  # 技术洞察与改进建议
```
