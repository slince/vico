# @vico/server

Vico 后端：Hono API 服务 + Agent 引擎。

提供 REST API（agents / skills / chat / observability / evals 等）、Agent 聊天管道、文件系统 Skill 插件、双层记忆、RAG 知识库、better-auth 认证与 SSE 流式响应。

## 启动

```bash
pnpm dev                              # 同时启动 server(3001) 与 web(5173)
pnpm --filter @vico/server dev        # 仅启动后端（tsx watch）
pnpm --filter @vico/server db:migrate # 执行数据库迁移
```

- 配置：`server.config.yaml`（支持 `${ENV_VAR}` 插值）
- 默认登录账号：`admin` / `admin123`

## 相关文档

- [架构说明](../../docs/architecture.md)
