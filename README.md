# Vico

面向中小企业的 AI Agent 管理平台，基于「配置 + 即插即用 Skill」架构，提供开箱即用的智能助手搭建能力。

## 特性

- **Agent 引擎** — 基于 Vercel AI SDK 的流式对话管道，支持多模型 LLM（OpenAI、Anthropic、DeepSeek、通义千问）
- **Skill 插件系统** — 文件系统扫描 + 动态加载，每个 Skill 自带提示词和工具，即装即用
- **双层记忆** — 短期滑动窗口缓存 + 长期向量记忆，自动从对话中提取用户事实
- **RAG 知识库** — 文档上传 → 分块向量化 → 混合搜索（70% 语义 + 30% 关键词）
- **多租户** — 基于 organization 的数据隔离，支持 `private`（单租户）和 `saas`（多租户）部署模式
- **管理后台** — React 19 + shadcn/ui 构建的 Web 控制台，涵盖 Agent/Skill/知识库/对话全生命周期管理

## 技术栈

| 层 | 技术 |
|---|------|
| 包管理 | pnpm 9 + Turborepo |
| 后端 | TypeScript、Hono 4、ESM |
| Agent 框架 | Vercel AI SDK (`ai` / `@ai-sdk/*`) |
| 数据库 | better-sqlite3（WAL 模式）+ Drizzle ORM |
| 嵌入模型 | Transformers.js（本地）/ OpenAI API |
| 认证 | better-auth（Session Cookie + organization 插件） |
| 前端 | React 19、Vite 6、Tailwind CSS 4 |
| UI 组件 | shadcn/ui（radix-rhea 风格） |
| 数据获取 | TanStack Query 5 |
| 校验 | Zod |

## 项目结构

```
packages/
├── server/          # 后端 API + Agent 引擎
│   └── src/
│       ├── index.ts         # Hono 启动、中间件注册
│       ├── config.ts        # YAML 配置加载器
│       ├── api/             # 路由处理器（auth、agents、skills、chat 等）
│       ├── agent/           # 聊天管道、工具执行器、模型注册
│       ├── skill/           # 插件系统（加载器、管理器、类型）
│       ├── memory/          # 短期/长期记忆、RAG、嵌入器
│       ├── auth/            # better-auth 实例 + Seed
│       └── db/              # Drizzle ORM、Schema、迁移
├── web/             # React 管理后台
│   └── src/
│       ├── main.tsx         # QueryClient + RouterProvider
│       ├── router.tsx       # 路由配置及认证守卫
│       ├── api/client.ts    # REST 客户端 + SSE 流式请求
│       └── pages-new/       # 新版页面（当前）
└── skills/          # 预置 Skill 插件
    └── <skill-name>/
        ├── manifest.json    # 元数据（名称、版本、参数）
        ├── prompt.md        # 系统提示词片段
        ├── tools.ts         # 工具定义 + 处理函数
        └── resources/       # 知识文档（可选）
```

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm 9

### 安装与运行

```bash
# 安装依赖
pnpm install

# 同时启动服务端（:3001）和前端（:5173）
pnpm dev

# 或分别启动
pnpm dev:server
pnpm dev:web
```

启动后访问 `http://localhost:5173`，使用默认账号登录：

- 用户名：`admin`
- 密码：`admin123`

### 安装 Skill

```bash
pnpm skill:install <skill-directory-path>
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 同时启动服务端和前端 |
| `pnpm build` | 构建所有包 |
| `pnpm dev:server` | 仅启动服务端 |
| `pnpm dev:web` | 仅启动前端 |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm skill:install <path>` | 从目录安装 Skill |

## 配置

服务端配置文件位于 `packages/server/server.config.yaml`：

```yaml
server:
  port: 3001
  deploy_mode: private          # 'private' 或 'saas'

auth:
  session_expiry_days: 7

database:
  url: "file:./data/vico.db"

skills:
  scan_paths:                   # Skill 扫描目录
    - "../skills"
    - "./data/custom-skills"

memory:
  stm_window: 20                # 短期记忆窗口（对话轮数）
  ltm_auto_extract: true        # 自动提取长期记忆
  ltm_max_entries: 10000

rag:
  chunk_size: 512
  chunk_overlap: 64
  retrieval_top_k: 5
  embedder: local               # 'local' 或 'api'
  embedder_model: "Xenova/all-MiniLM-L6-v2"
```

支持 `${ENV_VAR}` 环境变量插值。

## Skill 开发

每个 Skill 是一个独立目录，包含：

```
my-skill/
├── manifest.json    # { "name", "displayName", "version", "description", "parameters": {} }
├── prompt.md        # 注入 Agent 系统提示词的指令
├── tools.ts         # export default [ { definition: {...}, handler: async (args, ctx) => {...} } ]
└── resources/       # 可选：安装时自动索引到知识库
```

Skill 安装后可在管理后台绑定到任意 Agent，启用后其提示词和工具会自动注入对话管道。

## 架构概览

```
用户请求 → Hono API → Agent 引擎核心管道
                         ├─ 系统提示词拼接 (Agent + Skill + 长期记忆 + RAG)
                         ├─ AI SDK streamText (多轮工具调用)
                         └─ SSE 流式响应 → 持久化 → 记忆更新
```

详细架构文档见 [docs/architecture.md](docs/architecture.md)。

## 许可证

专有软件，保留所有权利。
