# Mastra 全栈迁移设计

> 日期：2026-06-13 | 状态：已批准

## 目标

移除双引擎 Legacy 代码，升级 AI SDK v4→v5/v6，全面迁移到 Mastra 框架（Agent/Memory/Storage/Vector/Tools/Processors 六层）。

## 目标架构

```
Hono API 层 (不变)
  │
  ▼
Mastra Agent Engine (全新)
  AgentFactory ──→ Mastra Agent ──→ agent.stream()
  Skill→Tools  RAG→Tool  Audit→Processor  Token→Processor
  │
  ├── Mastra Memory (@mastra/memory)
  │     thread/msg CRUD, semantic recall, working memory, observational
  ├── Mastra Vector (LibSQLVector)
  │     createIndex, query(topK), upsert/delete
  └── Drizzle + libsql (业务配置表)
        agents, skills, model_configs, knowledge_bases
  │
  ▼
libsql (本地文件 data/vico.db)
```

## 数据流

```
用户消息 → /api/v1/chat
  ├─ AgentFactory.create(agentId) ──→ Mastra Agent 实例
  ├─ agent.stream(messages) ──→ MastraModelOutput
  ├─ textStream ──→ SSE ReadableStream
  └─ Response (text/event-stream)
```

## 删除文件 (16 个)

| 文件 | 原因 |
|------|------|
| `agent/pipeline.ts` | Legacy 管道 |
| `agent/mastra/agent-factory.ts` | 假 Mastra 实现 |
| `agent/mastra/bridges/model-bridge.ts` | Mastra model 参数替代 |
| `agent/mastra/bridges/skill-bridge.ts` | Mastra createTool() 替代 |
| `agent/mastra/bridges/rag-bridge.ts` | Mastra Tool + Vector 替代 |
| `agent/mastra/bridges/auth-bridge.ts` | 不再需要 |
| `agent/mastra/processors/audit-logger.ts` | 重写为 Mastra Processor |
| `agent/mastra/processors/token-tracker.ts` | 重写为 Mastra Processor |
| `agent/mastra/processors/message-persister.ts` | Mastra Memory 处理 |
| `agent/mastra/storage.ts` | LibSQLStore 替代 |
| `agent/mastra/index.ts` | 入口重构 |
| `agent/tool-executor.ts` | Mastra Agent 内置工具执行 |
| `memory/long-term.ts` | Mastra Memory 替代 |
| `memory/working-memory.ts` | Mastra workingMemory 替代 |
| `memory/observational-memory.ts` | Mastra observationalMemory 替代 |
| `memory/embedder.ts` | Mastra embedder 替代 |

## 新增文件 (8 个)

| 文件 | 职责 |
|------|------|
| `agent/agent-factory.ts` | Vico Agent 配置 → Mastra Agent 实例 |
| `agent/processors/audit-logger.ts` | Mastra Processor 审计日志 |
| `agent/processors/token-tracker.ts` | Mastra Processor Token 统计 |
| `agent/tools/skill-tool-adapter.ts` | Vico SkillTool → Mastra createTool() |
| `agent/tools/rag-tool.ts` | RAG 检索→Mastra Tool |
| `agent/memory-setup.ts` | MastraMemory + LibSQLVector 初始化 |
| `agent/sse-utils.ts` | 统一 SSE ReadableStream 工厂 |
| `db/init-libsql.ts` | libsql 客户端 + Drizzle 初始化 |

## 数据库变更

- 驱动：better-sqlite3 → @libsql/client + drizzle-orm/libsql
- 删除表：memory_entries, chunks, tool_call_logs, token_usage_logs, conversations, messages (被 Mastra Memory/Vector/Processor 接管)
- 保留表：model_configs, agents, installed_skills, agent_skills, knowledge_bases, agent_knowledge_bases, agent_teams, agent_team_members
- 保留认证表：user, session, account, verification, organization, member, invitation

## 依赖变更

```diff
- "ai": "^4.0.0"
- "@ai-sdk/openai": "^1.0.0"
- "@ai-sdk/anthropic": "^1.0.0"
- "@ai-sdk/react": "^1.0.0"
- "better-sqlite3"
+ "@ai-sdk/openai": "^3.0.0"
+ "@ai-sdk/anthropic": "^1.2.0"
+ "@libsql/client": "^0.14.0"
+ "@mastra/memory": "^1.20.3"
  "@mastra/core": "^1.42.0"         (已有)
  "@mastra/libsql": "^1.13.0"       (已有)
  "@mastra/ai-sdk": "^1.4.5"        (已有)
  "drizzle-orm": "^0.45.2"          (改为 drizzle-orm/libsql)
```
