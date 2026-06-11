# CLAUDE.md

## 项目概述

Vico 是一个面向中小企业的 AI Agent 管理平台，基于"配置 + 即插即用 Skill"架构构建。提供支持多模型 LLM 的 Agent 引擎、管理后台 Web 控制台、基于文件系统的 Skill 插件系统、双层记忆管理以及 RAG 知识库。

## 技术栈

| 层 | 技术 |
|-------|-----------|
| 包管理器 | pnpm 9 + Turborepo（monorepo） |
| 后端 | TypeScript、Fastify 5、ESM |
| Agent 框架 | Vercel AI SDK 4（`ai` 包） |
| 数据库 | better-sqlite3（WAL 模式） |
| 嵌入模型 | Transformers.js（本地）/ OpenAI API |
| 认证 | JWT + bcryptjs |
| 前端 | React 19、Vite 6、Tailwind CSS 4 |
| UI 组件 | shadcn/ui（radix-rhea 风格） |
| 服务端状态 | TanStack Query 5 |
| 校验 | Zod |

## 目录结构

```
packages/
├── server/              # 后端 API + Agent 引擎
│   └── src/
│       ├── index.ts     # Fastify 启动、CORS、认证中间件
│       ├── config.ts    # YAML 配置加载器，支持环境变量插值
│       ├── api/         # 路由处理（Fastify 插件，按领域划分）
│       │   ├── router.ts、auth.ts、agents.ts、skills.ts、chat.ts 等
│       ├── agent/       # 聊天管道、工具执行器、模型注册中心
│       ├── skill/       # 插件系统：类型定义、加载器、管理器
│       ├── memory/      # 短期记忆、长期记忆、RAG、嵌入器
│       ├── auth/        # JWT 签发/校验、bcrypt、租户初始化
│       └── data/        # SQLite 单例、数据库迁移（13 张表）
├── web/                 # React 管理后台
│   └── src/
│       ├── main.tsx     # QueryClient + RouterProvider
│       ├── router.tsx   # 全部路由及认证守卫
│       ├── api/client.ts  # REST 客户端 + SSE 流式请求工具
│       ├── hooks/       # useAuth、use-mobile
│       ├── pages/       # 登录、仪表盘、Agent、Skill、知识库、会话、设置
│       └── components/  # 布局（侧边栏+容器）+ shadcn/ui 基础组件
└── skills/              # 预置 Skill 插件（基于文件系统）
    └── <skill-name>/
        ├── manifest.json   # 元数据：名称、版本、参数
        ├── prompt.md       # 系统提示词片段
        ├── tools.ts        # 导出 SkillTool 对象数组
        └── resources/      # 知识文档
```

## 常用命令

```bash
pnpm dev                  # 同时启动服务端（端口 3001）和前端（端口 5173）
pnpm build                # 构建所有包
pnpm db:migrate           # 执行数据库迁移
pnpm skill:install <path> # 从目录安装 Skill
```

- 服务端配置：`packages/server/server.config.yaml`（支持 `${ENV_VAR}` 插值）
- 默认登录账号：`admin` / `admin123`

## 架构说明

### 聊天管道（server/src/agent/pipeline.ts）

路由 → 加载 Agent 配置 → 解析模型 → 构建系统提示词（Agent 基础提示词 + Skill 提示词 + 长期记忆 + RAG 上下文）→ 组装工具 → 通过 AI SDK 调用 `streamText` → SSE 响应 → 持久化对话 → 更新短期记忆

### Skill 插件系统（server/src/skill/）

- 通过扫描配置的目录来发现 Skill
- 每个 Skill 从 `manifest.json` + `prompt.md` + `tools.ts` 加载
- `SkillManager` 是单例，通过 `agent_skills` 关联表管理 Agent 与 Skill 的绑定
- 工具在加载时通过动态 `import()` 引入

### 记忆与 RAG（server/src/memory/）

- **短期记忆**：基于内存 Map 缓存，采用滑动 FIFO 窗口
- **长期记忆**：向量嵌入 + SQLite 余弦相似度检索
- **RAG**：混合搜索（70% 语义 + 30% 关键词）、文本分块、去重
- **嵌入器**：双模式 — 本地 Transformers.js 或 OpenAI API，支持基于哈希的降级方案

### 认证

- 基于 JWT，通过 Fastify `onRequest` 钩子跳过公开路径
- 将 `authContext`（userId、tenantId、role）附加到每个请求
- 租户隔离：SaaS 模式下所有查询按 `tenant_id` 过滤
- 首次运行时自动创建默认租户和管理员用户

### 数据库

- 通过 `better-sqlite3` 预处理语句直接执行 SQL — 无 ORM
- 版本化迁移，位于 `src/data/migrations.ts`（由 `schema_version` 表跟踪）
- 通过 `getDb()` 获取单例连接
- 启用 WAL 模式以支持并发读取

## 关键模式

- **单例模式**：`skillManager`、`toolExecutor`、`shortTermMemory`、`longTermMemory`、`ragManager`、`getDb()` 均为模块级单例
- **Fastify 插件**：路由文件导出函数 `(app: FastifyInstance) => void`
- **SSE 流式传输**：通过 `ReadableStream` 实现 `text/event-stream`，由 AI SDK 异步迭代器转换
- **Provider 适配器**：模型注册中心将 provider 字符串映射到 Vercel AI SDK provider 函数
- **无 ORM**：所有数据库操作使用原生 SQL + 预处理语句
- **暂无测试**：早期 MVP 阶段

## shadcn/ui 备注

- 风格：`radix-rhea`，基础色：`neutral`，已启用 CSS 变量
- 组件别名：通过 `components.json` 配置（`@/components/ui`）
- 使用 `@/lib/utils` 中的 `cn()` 进行类名合并（clsx + tailwind-merge）
- 完整组件清单及用法详见 [docs/ui-components.md](docs/ui-components.md)（共 56 个组件组，200+ 导出）
