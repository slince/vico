# Vico Agent 引擎架构升级设计

## 概述

基于 Mastra 框架对 Vico Agent 引擎进行全面架构升级，覆盖三个维度：
1. **Agent 推理与决策能力**：从一次性 pipeline 升级为具备规划、反思、重试能力的自主推理循环
2. **多 Agent 协作与编排**：新增 Agent Network（supervisor 模式），支持多角色 Agent 团队协作
3. **记忆与知识系统升级**：从自定义 STM/LTM 升级为 Mastra 四层记忆架构

**技术决策：** 引入 Mastra（TypeScript 原生 Agent 框架）+ 保留 Vercel AI SDK + 保留 Hono，最大化复用现有技术栈和模块。

**推进策略：** 统一架构设计，分三个阶段实施。

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Vico 前端 (React 19) — 不变                        │
│  仪表盘 │ Agent管理 │ Skill管理 │ 知识库 │ 对话记录 │ LLM设置       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST + SSE (cookie session)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Vico Hono API 层 — 路由不变，内部重构               │
│                                                                      │
│  /api/v1/agents ────→ 仍读写 agents 表（配置界面用）                  │
│  /api/v1/skills ────→ 仍管理 Skill 安装/绑定                          │
│  /api/v1/models ────→ 仍管理 LLM 模型配置                             │
│  /api/v1/chat   ────→ 不再调 pipeline.ts，内部调 Mastra Agent         │
│  /api/v1/conversations → 不变（仍从 messages 表读取）                 │
│  /api/v1/teams   ────→ Phase 2 新增，Agent 团队管理                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Mastra Agent Runtime (新增，嵌入 Hono)                   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Mastra Instance                                              │   │
│  │  ├─ storage: LibSQL (复用 vico.db 路径，使用独立表)           │   │
│  │  ├─ agents: Map<agentId, MastraAgent>  动态构建+缓存          │   │
│  │  ├─ workflows: Map<agentId, Workflow>  任务编排               │   │
│  │  ├─ memory: MessageHistory + WorkingMemory + SemanticRecall   │   │
│  │  └─ logger: OpenTelemetry → 本地文件                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌────────────────┐   │
│  │ Vico Model│  │Vico Skill │  │Vico RAG  │  │ Vico Auth      │   │
│  │ Registry  │  │ → Mastra  │  │ → Mastra │  │ Context        │   │
│  │→Mastra   │  │   Tools   │  │  Semantic│  │→Mastra        │   │
│  │ Model    │  │  Bridge   │  │   Recall  │  │  threadId/    │   │
│  │ Bridge   │  │           │  │   Source  │  │  resourceId   │   │
│  └───────────┘  └───────────┘  └──────────┘  └────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心原则

- **路由层不变**：前端无需改动，API 契约保持一致
- **引擎层替换**：`pipeline.ts` → Mastra Agent runtime
- **数据层共存**：Vico 业务表保留（UI 配置/对话记录），Mastra 管理运行时状态（thread/memory/vector）
- **模块桥接**：4 个 Bridge 适配 Mastra 与 Vico 现有模块

### 边界：保留 vs 替换 vs 新增

| 模块 | 决策 | 所属阶段 |
|------|------|---------|
| `pipeline.ts` | ✕ 替换为 Mastra Agent 推理循环 | Phase 1 |
| `tool-executor.ts` | ✕ 替换为 Mastra Tool Execution | Phase 1 |
| `model-registry.ts` | ✓ 保留，作为 Model Bridge 数据源 | — |
| Skill 系统（loader/manager/types） | ✓ 保留，作为 Skill Bridge 数据源 | — |
| `short-term.ts` | ✕ 替换为 Mastra MessageHistory | Phase 3 |
| `long-term.ts` | ✕ 替换为 Mastra WorkingMemory + SemanticRecall | Phase 3 |
| `rag.ts` | ✓ 保留，作为 Mastra 检索源之一 | Phase 3 |
| `embedder.ts` | ✓ 保留，Mastra embedder 可能依赖 | Phase 3 |
| Auth（better-auth + getAuthContext） | ✓ 保留，作为 Auth Bridge | — |
| agents / conversations / messages 表 | ✓ 保留，UI 配置和对话记录 | — |
| `agent_teams` / `agent_team_members` 表 | 新增 | Phase 2 |
| Mastra Storage 表（LibSQL） | 新增 | Phase 1 |

---

## 二、4 个 Bridge 模块

### Bridge 1: Model Bridge — Vico Model Registry → Mastra Model

将 Vico `model_configs` 表中的配置映射为 Mastra 可用的 AI SDK model 实例。

**核心函数：** `createModelFromConfig(row: ModelConfigRow): LanguageModelV2`

**逻辑：**
1. 根据 `provider` 字段路由到对应 AI SDK provider：
   - `openai` → `createOpenAI({ apiKey, baseUrl })`
   - `anthropic` → `createAnthropic({ apiKey, baseUrl })`
   - `deepseek` / `qwen` / `custom` → `createOpenAI({ apiKey, baseUrl })`（OpenAI 兼容接口）
2. 每个 model 用 `withMastra()` 包裹，注入统一的 input/output processors

### Bridge 2: Skill Bridge — Vico Skill Tools → Mastra Tools

将 Vico Skill 系统中的 `SkillTool[]` 适配为 Mastra Agent 可用的 tools。

**核心函数：** `vicoToolsToMastraTools(agentId: string): Promise<Record<string, MastraTool>>`

**适配逻辑：**
1. 调用 `skillManager.getToolsForAgent(agentId)` 获取 SkillTool 数组
2. 将 JSON Schema `parameters` 转换为 Zod schema（使用 `json-schema-to-zod` 或手写映射）
3. 将 `handler` 包装为 Mastra tool 的 `execute` 函数，注入 `ToolContext`
4. `getSystemPrompt(agentId)` 拼接逻辑不变

### Bridge 3: RAG Bridge — Vico 知识库 → Mastra 检索源

**Phase 1-2 策略：** 保留 Vico RAG 作为 tool 提供给 Mastra Agent（`search_knowledge_base` tool）

**Phase 3 迁移：** 将 Vico chunks 数据导入 Mastra SemanticRecall，作为向量检索数据源

### Bridge 4: Auth Bridge — Vico Session → Mastra RuntimeContext

将 Vico better-auth session 信息映射为 Mastra 的 `resourceId`（租户隔离）和 `threadId`（对话连续性）。

**映射关系：**
- `resourceId = session.activeOrganizationId`（租户级记忆隔离）
- `threadId = conversationId`（对话级上下文连续性）

---

## 三、Phase 1: Agent 推理引擎增强

### 目标

将当前一次性的 `pipeline.ts` 替换为 Mastra Agent 自主推理循环，Agent 具备理解意图、调用工具、评估结果、修正重试的能力。

### 新增文件结构

```
packages/server/src/agent/
├── mastra/
│   ├── index.ts                     # getMastra() 单例
│   ├── agent-factory.ts             # Vico Agent → Mastra Agent 构建器
│   ├── bridges/
│   │   ├── model-bridge.ts          # Bridge 1
│   │   ├── skill-bridge.ts          # Bridge 2
│   │   ├── rag-bridge.ts            # Bridge 3（Phase 1 为 tool 模式）
│   │   └── auth-bridge.ts           # Bridge 4
│   ├── processors/
│   │   ├── audit-logger.ts          # 写入 tool_call_logs 表
│   │   ├── token-tracker.ts         # 写入 token_usage_logs 表
│   │   └── message-persister.ts     # 写入 messages 表
│   └── storage.ts                   # MastraStorage 配置（LibSQL）
├── pipeline.ts                      # 保留兼容，内部委托给 Mastra
├── tool-executor.ts                 # 保留兼容，内部委托给 Mastra
└── model-registry.ts                # 不变
```

### 核心流程：agent-factory.ts

将 Vico Agent 数据库配置构建为 Mastra Agent 实例，缓存复用：

```typescript
async function createMastraAgent(vicoAgentId: string, ctx: PipelineContext): Promise<MastraAgent> {
  const agentRow = await loadAgent(ctx.tenantId, vicoAgentId);
  const model = createModelBridge(agentRow.model_id);           // Bridge 1
  const tools = await createSkillToolsBridge(vicoAgentId);      // Bridge 2
  const systemPrompt = await buildSystemPrompt(vicoAgentId, ctx);

  return new Mastra.Agent({
    name: agentRow.name,
    instructions: systemPrompt,
    model: withMastra(model, {
      inputProcessors: [messagePersister],
      outputProcessors: [auditLogger, tokenTracker],
      memory: {
        storage: mastraStorage,
        threadId: ctx.conversationId,
        resourceId: ctx.tenantId,
        lastMessages: 20,
      },
    }),
    tools,
  });
}
```

### Chat API 兼容

`POST /api/v1/chat` 的内部实现改为调用 Mastra Agent，但对外 SSE 格式不变（`text_delta` / `done` / `error`），确保前端零改动。

### Phase 1 不包含

- Workflow 任务编排（Phase 2）
- 多 Agent 协作（Phase 2）  
- Mastra 四层记忆（Phase 3，Phase 1 仍用现有 STM/LTM + RAG）

---

## 四、Phase 2: 多 Agent 协作与编排

### 目标

基于 Mastra Agent Networks（supervisor 模式），实现多角色 Agent 团队协作。

### 协作模型

```
用户任务
  │
  ▼
编排 Agent (Orchestrator)
  ├─→ 数据分析 Agent (Skills: SQL查询 + 图表生成)
  ├─→ 报告撰写 Agent (Skills: 文档生成 + 格式化)
  └─→ 策略建议 Agent (Skills: SWOT分析 + 对比)
```

### 新增数据表

```sql
-- Agent 团队定义
CREATE TABLE agent_teams (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  orchestrator_id TEXT NOT NULL,     -- 编排 Agent ID（引用 agents 表）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_id, name)
);

-- 团队成员关系
CREATE TABLE agent_team_members (
  team_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT DEFAULT '',               -- 成员角色标签
  priority INTEGER DEFAULT 0,         -- 调度优先级（预留）
  PRIMARY KEY (team_id, agent_id),
  FOREIGN KEY (team_id) REFERENCES agent_teams(id) ON DELETE CASCADE
);
```

### 核心模块：orchestrator.ts

```typescript
async function createAgentNetwork(teamId: string, ctx: Context): Promise<MastraAgent> {
  const team = await loadTeam(teamId);
  const memberAgents: Record<string, MastraAgent> = {};

  for (const member of team.members) {
    memberAgents[member.agentId] = await createMastraAgent(member.agentId, ctx);
  }

  const orchestrator = await createMastraAgent(team.orchestratorId, ctx);

  return orchestrator.network({
    agents: memberAgents,
    routingStrategy: 'auto',  // Mastra 自动判断路由
  });
}
```

### 新增 API

| 方法 | 路由 | 功能 |
|------|------|------|
| `GET` | `/api/v1/teams` | 列出租户所有 Agent 团队 |
| `POST` | `/api/v1/teams` | 创建团队（指定编排 Agent） |
| `GET` | `/api/v1/teams/:id` | 团队详情（含成员列表） |
| `PUT` | `/api/v1/teams/:id/members` | 管理团队成员（全量替换） |
| `DELETE` | `/api/v1/teams/:id` | 删除团队 |
| `POST` | `/api/v1/teams/:id/chat` | 向团队发起对话（SSE） |

### 用户使用流程

1. 分别创建各职能 Agent（配置各自的 Prompt + Skill + 知识库）
2. 创建一个编排 Agent（system_prompt 指定其协调者角色）
3. 创建团队，选择编排 Agent + 成员 Agent
4. 在聊天界面选择团队（而非单个 Agent）发起对话

---

## 五、Phase 3: 记忆与知识系统升级

### 目标

用 Mastra 四层记忆架构替代自定义 STM/LTM，同时保留 Vico RAG 作为附加检索源。

### 记忆层级对照

| 层级 | Vico 当前 | Mastra 对应 | 迁移策略 |
|------|----------|------------|---------|
| 消息历史 | STM (Map 缓存) | MessageHistory processor | 替换，持久化到 LibSQL |
| 工作记忆 | 不存在 | WorkingMemory processor | 新增，自动提取用户事实 |
| 语义回忆 | LTM (向量+余弦相似度) | SemanticRecall processor | 替换，向量存 LibSQL |
| 观察记忆 | 不存在 | ObservationalMemory | 新增，长对话摘要压缩 |
| 知识检索 | Vico RAG (混合搜索) | Mastra SemanticRecall | Vico RAG 作为附加 tool |

### 运行时记忆注入流程

```
用户消息
  │
  ▼
┌─────────────────────────────────────────────┐
│  Mastra Memory Pipeline (自动执行)           │
│                                              │
│  1. WorkingMemory — 检索用户画像/偏好       │
│  2. MessageHistory — 加载最近 N 轮对话      │
│  3. SemanticRecall — 向量检索相关历史记忆    │
│     └─ 同时查询 Vico RAG chunks（桥接模式）  │
│                                              │
│  → 全部注入 Agent 上下文                     │
└─────────────────────────────────────────────┘
  │
  ▼
Agent 推理 → 生成回复
  │
  ▼
┌─────────────────────────────────────────────┐
│  Mastra Memory 存储 (自动执行)               │
│                                              │
│  1. MessageHistory — 持久化本轮消息          │
│  2. SemanticRecall — 向量化并存储            │
│  3. ObservationalMemory — 定期摘要压缩       │
│  4. WorkingMemory — 提取并更新用户事实       │
└─────────────────────────────────────────────┘
```

### 旧数据迁移

- `memory_entries` 表数据通过 Mastra Storage API 批量导入 SemanticRecall
- `chunks` 表保留（前端知识库管理 UI 依赖），同时作为 Mastra 检索数据源
- `messages` 表保留（对话记录 UI 依赖），同时写入 Mastra MessageHistory

### 清理清单

| 文件 | 动作 |
|------|------|
| `packages/server/src/memory/short-term.ts` | 删除 |
| `packages/server/src/memory/long-term.ts` | 删除 |
| `memory_entries` 表 | 迁移后删除 |
| `packages/server/src/memory/rag.ts` | 保留 |
| `packages/server/src/memory/embedder.ts` | 保留 |

---

## 六、实施路线图

### Phase 1: Agent 推理引擎增强（预计工作量最大）

| 步骤 | 内容 |
|------|------|
| 1.1 | 安装 Mastra 依赖（`@mastra/core`, `@mastra/hono`, `@mastra/ai-sdk`） |
| 1.2 | 实现 `storage.ts`：Mastra LibSQL Storage 配置，复用 vico.db |
| 1.3 | 实现 `model-bridge.ts`：Vico ModelConfig → AI SDK + withMastra() |
| 1.4 | 实现 `skill-bridge.ts`：Vico SkillTool → Mastra Tool（JSON Schema → Zod） |
| 1.5 | 实现 `auth-bridge.ts`：AuthContext → Mastra RuntimeContext |
| 1.6 | 实现 `agent-factory.ts`：Agent 构建 + 缓存 + 生命周期 |
| 1.7 | 实现 3 个 processors（audit-logger, token-tracker, message-persister） |
| 1.8 | 改造 `api/chat.ts`：委托给 Mastra Agent，保持 SSE 格式兼容 |
| 1.9 | 保留 `pipeline.ts` 作为 fallback，添加 feature flag |
| 1.10 | 前端对接测试，验证 SSE 流式输出兼容性 |

### Phase 2: 多 Agent 协作

| 步骤 | 内容 |
|------|------|
| 2.1 | 创建 `agent_teams` + `agent_team_members` 表，执行迁移 |
| 2.2 | 实现 Teams CRUD API |
| 2.3 | 实现 `orchestrator.ts`：构建 Agent Network |
| 2.4 | 实现 `/api/v1/teams/:id/chat` SSE 端点 |
| 2.5 | 前端：新增 Agent 团队管理页面 |

### Phase 3: 记忆系统升级

| 步骤 | 内容 |
|------|------|
| 3.1 | 启用 Mastra WorkingMemory + SemanticRecall processors |
| 3.2 | 将 Vico RAG 桥接为 Mastra SemanticRecall 数据源 |
| 3.3 | 实现 ObservationalMemory 长对话摘要 |
| 3.4 | 迁移 `memory_entries` 历史数据 |
| 3.5 | 删除 `short-term.ts` 和 `long-term.ts` |
| 3.6 | 性能调优（向量检索索引、内存缓存策略） |

---

## 七、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Mastra API 不稳定 | 升级困难 | Phase 1 保留 pipeline.ts 兼容层 + feature flag 快速回退 |
| JSON Schema → Zod 转换不完整 | 部分 Skill Tool 参数解析失败 | 优先支持常见类型（string/number/boolean/enum/array/object），复杂类型降级为 `z.any()` |
| Mastra Storage 与 Drizzle 共用 SQLite 冲突 | 数据损坏 | 使用独立表前缀（`mastra_*`），不同连接实例 |
| 性能下降 | Agent 推理变慢 | Agent 实例缓存、连接池、并行工具调用 |
| 多 Agent 协作路由不准 | 编排 Agent 将任务分配给错误的子 Agent | 编排 Agent 的 system_prompt 精心设计，加入路由规则和示例 |

---

## 八、成功标准

### Phase 1 验收

- [ ] 现有 Chat API SSE 格式完全兼容，前端无需改动
- [ ] Agent 能自主进行多轮工具调用并返回结果
- [ ] 工具调用审计日志正常写入 `tool_call_logs`
- [ ] Token 用量正常写入 `token_usage_logs`
- [ ] 对话消息正常写入 `messages` 表
- [ ] pipeline.ts feature flag 一键回退可用

### Phase 2 验收

- [ ] 多 Agent 团队能正确路由任务到子 Agent
- [ ] 团队成员可动态增减
- [ ] 团队对话 SSE 流式输出正常

### Phase 3 验收

- [ ] 跨对话记忆保持（同一用户不同对话间隔后可回忆）
- [ ] 长对话自动摘要压缩，不超出 token 限制
- [ ] 历史 memory_entries 数据无损迁移
