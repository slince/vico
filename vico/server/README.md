# @vico/server

Vico 后端：Hono API 服务 + Agent 引擎。

提供 REST API（agents / skills / chat / observability / evals 等）、Agent 聊天管道、文件系统 Skill 插件、双层记忆、RAG 知识库、better-auth 认证与 SSE 流式响应。

## 启动

```bash
pnpm dev                              # 同时启动 server(3001) 与 web(5173)
pnpm --filter @vico/server db:migrate # 执行数据库迁移
```

- 配置：`server.config.yaml`（支持 `${ENV_VAR}` 插值）
- 默认登录账号：`admin` / `admin123`

## 主要目录

- `src/api/` — Hono 路由（按领域划分）
- `src/agent/` — 聊天管道、工具执行、模型注册、可观测性、Evals
- `src/memory/` — 记忆子系统
- `src/skill/` — Skill 插件系统
- `src/db/` — Drizzle ORM schema 与迁移
- `src/auth/` — better-auth 配置与默认管理员 seed

## 依赖（内部）

- `@vico/core` — 聚合入口
- `@vico/thread-libsql` / `@vico/checkpoint-libsql` / `@vico/memory-libsql` / `@vico/rag-libsql` — LibSQL 持久化实现

## 相关文档

- [架构说明](../../docs/architecture.md)
