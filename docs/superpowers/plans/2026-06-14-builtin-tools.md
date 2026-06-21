# Builtin Tools 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Vico Agent 引擎实现按 Agent 可配置的内置基础工具集（基于 Mastra Workspace），支持 exec 命令审批流程。

**Architecture:** 复用现有 Mastra Workspace + LocalFilesystem + LocalSandbox 生成的 9 个工具（read_file/write_file/edit_file/execute_command/list_files/grep/file_stat/mkdir/delete），新增 BuiltinToolManager 按 Agent 配置过滤工具，exec 工具通过 Promise + DB 审批表实现可配置的审批流程。

**Tech Stack:** Mastra Workspace、better-sqlite3 + Drizzle ORM、Hono SSE、Zod

---

## 文件结构

```
packages/server/
├── server.config.yaml                          # [已存在] workspace 配置
├── src/
│   ├── config.ts                               # [已存在] workspace 类型已定义
│   ├── db/
│   │   ├── schema.ts                           # [修改] 新增 exec_approvals 表 + agents.builtin_tools 列
│   │   └── run-migrations.ts                   # [已存在] Drizzle 迁移
│   ├── drizzle/
│   │   └── 0003_builtin_tools.sql              # [新建] 迁移 SQL
│   ├── services/agent/
│   │   ├── types.ts                            # [修改] 新增 BuiltinToolsConfig 类型 + schema 字段
│   │   └── agent-manager.ts                    # [修改] create/update/list 支持 builtin_tools
│   ├── agent/tools/builtin/
│   │   └── index.ts                            # [修改] 重构为 BuiltinToolManager 类，支持按 Agent 过滤 + exec 审批包装
│   ├── agent/tools/agent-tool.factory.ts       # [修改] createAgentTool 注入 per-agent builtin tools
│   ├── chat/chat.ts                            # [修改] mainAgent 分支也使用 per-agent 过滤（main 用全量默认）
│   ├── api/
│   │   ├── agents.ts                           # [修改] PATCH schema 支持 builtin_tools
│   │   ├── exec-approvals.ts                   # [新建] 审批 API 路由
│   │   └── router.ts                           # [修改] 注册新路由
│   └── agent/sse-utils.ts                      # [修改] 新增 approval_required 事件类型支持
```

---

### Task 1: 数据库迁移 — agents 表加 builtin_tools 列 + exec_approvals 新表

**Files:**
- Create: `packages/server/drizzle/0003_builtin_tools.sql`
- Modify: `packages/server/src/db/schema.ts` (新增 exec_approvals 表定义)

- [ ] **Step 1: 创建迁移 SQL 文件**

```sql
-- 0003_builtin_tools.sql
ALTER TABLE agents ADD COLUMN builtin_tools TEXT NOT NULL DEFAULT '{}';

CREATE TABLE exec_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES organization(id),
  agent_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
```

- [ ] **Step 2: 更新 Drizzle schema，新增 exec_approvals 表定义**

在 `packages/server/src/db/schema.ts` 末尾新增：

```typescript
/** 命令执行审批表 */
export const exec_approvals = sqliteTable('exec_approvals', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  agent_id: text('agent_id').notNull(),
  command: text('command').notNull(),
  status: text('status').notNull().default('pending'),
  created_at: integer('created_at').notNull(),
  resolved_at: integer('resolved_at'),
});
```

同时在 `packages/server/src/db/schema-index.ts` 中导出：

```typescript
export { model_configs, agents, memory_entries, installed_skills, agent_skills, knowledge_bases, agent_knowledge_bases, agentTeams, agentTeamMembers, exec_approvals } from './schema';
```

- [ ] **Step 3: 运行迁移验证**

```bash
cd vico/server && pnpm db:migrate
```

Expected: 迁移成功执行，agents 表新增 builtin_tools 列，exec_approvals 表创建。

- [ ] **Step 4: Commit**

```bash
git add vico/server/drizzle/0003_builtin_tools.sql vico/server/src/db/schema.ts vico/server/src/db/schema-index.ts
git commit -m "feat: add builtin_tools column and exec_approvals table migration"
```

---

### Task 2: 更新类型定义和校验 Schema

**Files:**
- Modify: `packages/server/src/services/agent/types.ts`

- [ ] **Step 1: 新增 BuiltinToolsConfig 类型 + 更新 AgentRow**

在 `types.ts` 顶部新增类型定义，更新 `AgentRow` 接口：

```typescript
/** 单个内置工具的配置：简单工具为 boolean，exec 支持 need_approval */
export type BuiltinToolEntry = boolean | { enabled: boolean; need_approval?: boolean };

/** Agent 内置工具配置 */
export type BuiltinToolsConfig = Record<string, BuiltinToolEntry>;

/** agents 表行类型 */
export interface AgentRow {
  id: string;
  tenant_id: string;
  name: string;
  system_prompt: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
  rag_mode: string;
  max_steps: number;
  enabled: number;
  builtin_tools: string;  // 新增 — JSON string of BuiltinToolsConfig
  created_at: number;
  updated_at: number;
}
```

- [ ] **Step 2: 更新 createAgentSchema 和 updateAgentSchema**

```typescript
/** 内置工具 entry 的 Zod 校验 */
const builtinToolEntrySchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean(),
    need_approval: z.boolean().optional(),
  }),
]);

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent 名称不能为空'),
  system_prompt: z.string().optional().default(''),
  model_id: z.string().optional().default(''),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().int().positive().optional().default(4096),
  max_steps: z.number().int().positive().optional().default(10),
  rag_mode: z.string().optional().default('auto'),
  builtin_tools: z.record(z.string(), builtinToolEntrySchema).optional().default({}),  // 新增
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  system_prompt: z.string().optional(),
  model_id: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_steps: z.number().int().positive().optional(),
  rag_mode: z.string().optional(),
  enabled: z.number().min(0).max(1).optional(),
  builtin_tools: z.record(z.string(), builtinToolEntrySchema).optional(),  // 新增
});
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/services/agent/types.ts
git commit -m "feat: add BuiltinToolsConfig types and validation schemas"
```

---

### Task 3: 更新 AgentManager 支持 builtin_tools 字段

**Files:**
- Modify: `packages/server/src/services/agent/agent-manager.ts`

- [ ] **Step 1: 更新 create() 方法，写入 builtin_tools**

在 `create()` 方法的 `db.insert(agents).values({...})` 调用中新增 `builtin_tools` 字段：

```typescript
async create(tenantId: string, input: unknown): Promise<AgentDetail> {
  const data = createAgentSchema.parse(input) as CreateAgentInput;
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  await db.insert(agents).values({
    id,
    tenant_id: tenantId,
    name: data.name,
    system_prompt: data.system_prompt,
    model_id: data.model_id,
    temperature: data.temperature,
    max_tokens: data.max_tokens,
    max_steps: data.max_steps,
    rag_mode: data.rag_mode,
    builtin_tools: JSON.stringify(data.builtin_tools ?? {}),  // 新增
    enabled: 1,
    created_at: now,
    updated_at: now,
  }).run();

  agentToolStore.invalidate(tenantId);
  return (await this.getById(tenantId, id))!;
}
```

- [ ] **Step 2: 更新 update() 方法，builtin_tools 序列化为 JSON 字符串**

在 `update()` 方法中，对 `builtin_tools` 字段做 JSON 序列化处理：

```typescript
async update(tenantId: string, id: string, input: unknown): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
    .get();
  if (!existing) throw new Error('Agent not found');

  const parsed = updateAgentSchema.parse(input) as UpdateAgentInput;
  const updateData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== undefined) updateData[k] = v;
  }

  if (Object.keys(updateData).length === 0) return;

  // builtin_tools 对象序列化为 JSON 字符串存入 DB
  if (updateData.builtin_tools !== undefined) {
    updateData.builtin_tools = JSON.stringify(updateData.builtin_tools);
  }

  updateData.updated_at = Date.now();
  await db.update(agents).set(updateData)
    .where(and(eq(agents.tenant_id, tenantId), eq(agents.id, id)))
    .run();

  agentToolStore.invalidate(tenantId);
}
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/services/agent/agent-manager.ts
git commit -m "feat: support builtin_tools field in agent create/update"
```

---

### Task 4: 重构 BuiltinToolManager — 支持按 Agent 配置过滤工具

**Files:**
- Modify: `packages/server/src/agent/tools/builtin/index.ts`

- [ ] **Step 1: 重写 builtin/index.ts 为 BuiltinToolManager 类**

将当前函数式实现改为类，支持按 Agent 配置过滤和 exec 审批包装：

```typescript
/**
 * BuiltinToolManager — 基于 Mastra Workspace 的内置工具管理器。
 *
 * 复用 Mastra 的 Workspace + LocalFilesystem + LocalSandbox 生成的工具，
 * 支持按 Agent 的 builtin_tools 配置过滤启用的工具。
 * exec 工具可选包装审批流程。
 */
import { config } from '../../../config.js';
import type { Tool } from '@mastra/core/tools';
import type { BuiltinToolsConfig } from '../../../services/agent/types.js';
import { getDb, schema } from '../../../db/db.js';
import { v4 as uuid } from 'uuid';

/** Mastra workspace 工具名 → 配置 key 的映射 */
const TOOL_NAME_MAP: Record<string, string> = {
  mastra_workspace_read_file: 'read',
  mastra_workspace_write_file: 'write',
  mastra_workspace_edit_file: 'edit',
  mastra_workspace_execute_command: 'exec',
  mastra_workspace_list_files: 'ls',
  mastra_workspace_grep: 'grep',
  mastra_workspace_file_stat: 'stat',
  mastra_workspace_mkdir: 'mkdir',
  mastra_workspace_delete: 'delete',
};

/**
 * 解析 Agent 的 builtin_tools JSON 配置。
 * 返回 Map<simple_name, { enabled: boolean; need_approval?: boolean }>
 */
function parseBuiltinConfig(agent: { builtin_tools: string }): Map<string, { enabled: boolean; need_approval?: boolean }> {
  try {
    const raw: BuiltinToolsConfig = JSON.parse(agent.builtin_tools || '{}');
    const map = new Map<string, { enabled: boolean; need_approval?: boolean }>();
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === 'boolean') {
        map.set(key, { enabled: val });
      } else {
        map.set(key, { enabled: val.enabled, need_approval: val.need_approval });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

class BuiltinToolManager {
  private cachedTools: Record<string, Tool> | null = null;

  /**
   * 初始化（或返回缓存的）所有 Mastra workspace 工具。
   */
  private async getAllTools(): Promise<Record<string, Tool>> {
    if (this.cachedTools) return this.cachedTools;

    const [{ Workspace, LocalFilesystem, LocalSandbox, createWorkspaceTools }] = await Promise.all([
      import('@mastra/core/workspace'),
    ]);

    const { base_path, contained, allowed_paths, timeout_ms, isolation } = config.workspace;

    const filesystem = new LocalFilesystem({
      basePath: base_path,
      contained,
      allowedPaths: allowed_paths.length > 0 ? allowed_paths : undefined,
    });

    const sandbox = new LocalSandbox({
      workingDirectory: base_path,
      timeout: timeout_ms,
      isolation: isolation as 'none' | 'seatbelt' | 'bwrap',
    });

    const workspace = new Workspace({
      filesystem,
      sandbox,
      tools: { requireApproval: false },
    });

    await workspace.init();
    this.cachedTools = await createWorkspaceTools(workspace);
    return this.cachedTools;
  }

  /**
   * 获取指定 Agent 启用的内置工具。
   * 根据 Agent 的 builtin_tools 配置过滤，exec 工具根据 need_approval 决定是否包装审批。
   *
   * @param agent - Agent 行（含 builtin_tools 字段）
   * @param tenantId - 租户 ID
   * @returns toolId → Tool 的映射
   */
  async getToolsForAgent(
    agent: { builtin_tools: string },
    tenantId: string,
  ): Promise<Record<string, Tool>> {
    const allTools = await this.getAllTools();
    const config = parseBuiltinConfig(agent);
    const result: Record<string, Tool> = {};

    for (const [mastraName, tool] of Object.entries(allTools)) {
      const simpleName = TOOL_NAME_MAP[mastraName];
      if (!simpleName) continue;

      const entry = config.get(simpleName);
      if (!entry || !entry.enabled) continue;

      // exec 工具：如果配置了 need_approval，包装审批逻辑
      if (simpleName === 'exec' && entry.need_approval) {
        result[mastraName] = this.wrapExecWithApproval(tool, tenantId);
      } else {
        result[mastraName] = tool;
      }
    }

    return result;
  }

  /**
   * 包装 exec 工具的 execute 方法，加入审批流程。
   *
   * 审批流程：
   * 1. 写入 exec_approvals 表（status=pending）
   * 2. 轮询等待审批结果（每 500ms 查一次 DB，最长等 5 分钟）
   * 3. approved → 执行原工具逻辑；rejected → 返回拒绝消息
   */
  private wrapExecWithApproval(tool: Tool, tenantId: string): Tool {
    const originalExecute = tool.execute.bind(tool);
    const wrappedTool = { ...tool };

    wrappedTool.execute = async (args: any) => {
      const command = args?.command ?? args?.params?.command ?? '';
      const db = getDb();
      const approvalId = uuid();

      // 写入审批记录
      await db.insert(schema.exec_approvals).values({
        id: approvalId,
        tenant_id: tenantId,
        agent_id: '',
        command: String(command),
        status: 'pending',
        created_at: Date.now(),
        resolved_at: null,
      }).run();

      // 轮询等待审批（最长 5 分钟）
      const startTime = Date.now();
      const maxWaitMs = 5 * 60 * 1000;
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 500));
        const record = await db.select({ status: schema.exec_approvals.status })
          .from(schema.exec_approvals)
          .where(eq(schema.exec_approvals.id, approvalId))
          .get();

        if (!record) break;
        if (record.status === 'approved') {
          // 审批通过，执行原工具
          return originalExecute(args);
        }
        if (record.status === 'rejected') {
          return 'Command execution was rejected by the user.';
        }
      }

      return 'Command execution approval timed out. Please try again.';
    };

    return wrappedTool;
  }

  /** 清除缓存 */
  invalidate(): void {
    this.cachedTools = null;
  }
}

export const builtinToolManager = new BuiltinToolManager();
```

注意：需要在文件顶部补充 `eq` 的导入：
```typescript
import { eq } from 'drizzle-orm';
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd vico/server && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/tools/builtin/index.ts
git commit -m "feat: refactor BuiltinToolManager with per-agent filtering and exec approval wrapper"
```

---

### Task 5: 更新 agent-tool.factory.ts — 注入 per-agent builtin tools

**Files:**
- Modify: `packages/server/src/agent/tools/agent-tool.factory.ts`

- [ ] **Step 1: 在 createAgentTool 中注入 builtin tools**

在 `createAgentTool()` 函数中，Skill Tools + RAG Tool 的基础上追加 builtin tools：

在文件顶部添加导入：
```typescript
import { builtinToolManager } from './builtin/index.js';
```

在 `execute` 函数中的 tools 构建部分（第 53-68 行区域），追加 builtin tools：

```typescript
// 3. 构建 tools: Skill Tools + RAG Tool + Builtin Tools
const tools: Record<string, any> = {};
const skillTools = await getSkillToolsForMastraAgent(agent.id, {
  tenantId,
  agentId: agent.id,
  userId: '',
  skillConfig: {},
});
Object.assign(tools, skillTools);

if (agent.rag_mode !== 'disabled') {
  const ragTool = await createRagSearchTool(agent);
  if (ragTool) {
    tools[ragTool.id] = ragTool;
  }
}

// 追加 per-agent 配置的内置工具（AgentDetail extends AgentRow，builtin_tools 已在 Task 2 新增）
const builtinTools = await builtinToolManager.getToolsForAgent(
  { builtin_tools: agent.builtin_tools ?? '{}' },
  tenantId,
);
Object.assign(tools, builtinTools);
```

注意：`AgentDetail` 目前没有 `builtin_tools` 字段（Task 2 只更新了 `AgentRow`），需要在 `AgentDetail extends AgentRow` 中自动继承。确认 `AgentDetail` 已包含该字段（因为 extends AgentRow）。

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/tools/agent-tool.factory.ts
git commit -m "feat: inject per-agent builtin tools in createAgentTool"
```

---

### Task 6: 更新 chat.ts — mainAgent 分支使用 per-agent 过滤

**Files:**
- Modify: `packages/server/src/chat/chat.ts`

- [ ] **Step 1: 更新 mainAgent 分支，使用 builtinToolManager 按配置获取工具**

当前 `chat.ts` 第 73 行直接调用 `createBuiltinTools()` 获取全部工具。改为通过 `builtinToolManager.getToolsForAgent()` 获取 main agent 的专用工具（main agent 默认开启核心工具）。

修改导入：
```typescript
// 替换
import { createBuiltinTools } from '../agent/tools/builtin/index.js';
// 为
import { builtinToolManager } from '../agent/tools/builtin/index.js';
```

修改 `agentId === 'main'` 分支（约第 67-85 行）：

```typescript
if (agentId === 'main') {
  const vicoAgent = mastra.getAgent('mainAgent');
  const agentTools = await agentToolStore.getToolsForTenant(tenantId);
  const agentDescriptions = await agentToolStore.getAgentDescriptions(tenantId);

  // mainAgent 默认开启全量内置工具
  const builtinTools = await builtinToolManager.getToolsForAgent(
    { builtin_tools: '{"read":true,"write":true,"edit":true,"ls":true,"grep":true,"stat":true}' },
    tenantId,
  );

  const allTools = { ...builtinTools, ...agentTools };

  instructions = `${await vicoAgent.getInstructions()}${agentDescriptions ? `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}` : ''}`;

  output = await vicoAgent.stream([{ role: 'user', content: message }], {
    clientTools: allTools,
    instructions,
    memory: { thread: threadId, resource: tenantId },
    maxSteps: 15,
    requestContext,
  });
}
```

修改 `else` 分支（用户自定义 Agent，约第 86-109 行）：

```typescript
} else {
  const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
  if (!agentConfig) {
    return new Response(JSON.stringify({ error: 'Agent not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  requestContext.set('model', agentConfig.model);
  instructions = agentConfig.instructions;

  // 获取 Agent 详情以读取 builtin_tools 配置
  const agentDetail = await agentManager.getById(tenantId, agentId);
  const builtinTools = agentDetail
    ? await builtinToolManager.getToolsForAgent(agentDetail, tenantId)
    : {};

  const agentProxy = mastra.getAgent('agentProxy');
  output = await agentProxy.stream([{ role: 'user', content: message }], {
    instructions,
    clientTools: builtinTools,
    memory: { thread: threadId, resource: tenantId },
    maxSteps: agentConfig.maxSteps,
    requestContext,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/chat/chat.ts
git commit -m "feat: use per-agent builtin tools config in chat pipeline"
```

---

### Task 7: 新增 exec 审批 API 路由

**Files:**
- Create: `packages/server/src/api/exec-approvals.ts`
- Modify: `packages/server/src/api/router.ts`

- [ ] **Step 1: 创建审批路由文件**

```typescript
/**
 * Exec 审批 API 路由。
 *
 * 提供待审批列表查询和审批处理（批准/拒绝）端点。
 */
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';

export function execApprovalRoutes(app: Hono<{ Variables: Variables }>) {
  /**
   * GET /api/v1/exec-approvals/pending
   * 获取当前租户所有待审批的命令执行请求。
   */
  app.get('/api/v1/exec-approvals/pending', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const db = getDb();
    const rows = await db.select()
      .from(schema.exec_approvals)
      .where(and(
        eq(schema.exec_approvals.tenant_id, auth.tenantId),
        eq(schema.exec_approvals.status, 'pending'),
      ))
      .orderBy(desc(schema.exec_approvals.created_at))
      .all();

    return c.json(rows);
  });

  /**
   * POST /api/v1/exec-approvals/:id/resolve
   * 批准或拒绝一个待审批命令。Body: { action: "approve" | "reject" }
   */
  app.post('/api/v1/exec-approvals/:id/resolve', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const approvalId = c.req.param('id');
    const body = await c.req.json();
    const { action } = body;

    if (action !== 'approve' && action !== 'reject') {
      return c.json({ error: 'action must be "approve" or "reject"' }, 400);
    }

    const db = getDb();
    const record = await db.select({ id: schema.exec_approvals.id })
      .from(schema.exec_approvals)
      .where(and(
        eq(schema.exec_approvals.id, approvalId),
        eq(schema.exec_approvals.tenant_id, auth.tenantId),
      ))
      .get();

    if (!record) {
      return c.json({ error: 'Approval not found' }, 404);
    }

    await db.update(schema.exec_approvals)
      .set({
        status: action === 'approve' ? 'approved' : 'rejected',
        resolved_at: Date.now(),
      })
      .where(eq(schema.exec_approvals.id, approvalId))
      .run();

    return c.json({ message: action === 'approve' ? 'approved' : 'rejected' });
  });
}
```

- [ ] **Step 2: 在 router.ts 中注册新路由**

在 `registerRoutes` 函数中添加：

```typescript
import { execApprovalRoutes } from './exec-approvals.js';

export function registerRoutes(app: Hono<{ Variables: Variables }>) {
  authRoutes(app);
  agentRoutes(app);
  skillRoutes(app);
  knowledgeRoutes(app);
  modelRoutes(app);
  dashboardRoutes(app);
  chatRoutes(app);
  teamRoutes(app);
  conversationRoutes(app);
  execApprovalRoutes(app);  // 新增
}
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/api/exec-approvals.ts vico/server/src/api/router.ts
git commit -m "feat: add exec approval API endpoints"
```

---

### Task 8: SSE 通知 — 审批事件推送到 Web 端

**Files:**
- Modify: `packages/server/src/agent/sse-utils.ts`
- Modify: `packages/server/src/agent/tools/builtin/index.ts`

- [ ] **Step 1: 在 SSE 流中支持 approval_required 事件**

在 `createSSEStream` 中，tool_result 事件处理后，检查是否为 exec 工具的审批等待结果，发出 `approval_required` 事件：

在 sse-utils.ts 的 `createSSEStream` 函数内，`toolCalls` 事件处理处（约第 64 行），新增对 `mastra_workspace_execute_command` tool_call 的拦截：

```typescript
// 3. 逐条发出工具调用事件
for (const tc of toolCalls) {
  const p = tc.payload;
  enqueue({ type: 'tool_call', toolName: p.toolName, args: p.args });

  // exec 命令调用时，额外发出 approval_required 事件供 Web 端展示审批卡片
  if (p.toolName === 'mastra_workspace_execute_command' && p.args) {
    const cmd = typeof p.args.command === 'string'
      ? p.args.command
      : JSON.stringify(p.args);
    enqueue({
      type: 'approval_required',
      toolName: p.toolName,
      command: cmd,
      message: `Exec command requires approval: ${cmd}`,
    });
  }
}
```

注意：由于审批发生在 tool 执行期间（execute 内部轮询），SSE 流会在此处自然等待 tool_result 返回。前端可以在收到 `tool_call`（exec 类型）时展示审批卡片，审批结果由 tool_result 携带返回。

- [ ] **Step 2: 调整审批机制 — 从轮询 DB 改为不阻塞 SSE**

重新考虑 Task 4 中的 `wrapExecWithApproval` 实现。当前实现是在 execute 内部轮询 DB 等待审批，这会导致 SSE 流被阻塞在 tool 执行处，直到审批完成。这是正确的行为 — agent 在等 exec 结果，审批未完成前无法继续。

但如果审批超时（5 分钟），整个流可能已断开。将超时缩短到 2 分钟更合理。更新 `builtin/index.ts` 中的 `maxWaitMs`：

```typescript
const maxWaitMs = 2 * 60 * 1000; // 2 分钟审批超时
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/sse-utils.ts vico/server/src/agent/tools/builtin/index.ts
git commit -m "feat: add approval_required SSE event for exec tool calls"
```

---

### Task 9: Web 端 — 审批 UI 卡片

**Files:**
- 具体文件由前端判断，以下为方向性指导

- [ ] **Step 1: 聊天页面监听 `approval_required` 事件**

在 SSE 事件解析循环中新增 `approval_required` case，弹出审批卡片。

- [ ] **Step 2: 审批卡片组件**

展示命令内容 + 批准/拒绝按钮。按钮调用 API：
- 批准：`POST /api/v1/exec-approvals/pending/:id/resolve` body `{ action: "approve" }`
- 拒绝：`POST /api/v1/exec-approvals/pending/:id/resolve` body `{ action: "reject" }`

注意：审批 UI 需要知道 `approvalId`。当前审批记录在 tool execute 内部创建，前端无法直接获取 ID。需要在 SSE 事件中传递 approvalId，或通过 pending 列表 API 查找。

**简化方案**：在 `approval_required` 事件中携带 `approvalId`。修改 Task 4 中 `wrapExecWithApproval` 的审批记录创建时机，改为在 execute 开始时就生成 ID 并通过某种方式暴露给 SSE 层。

当前架构限制：Mastra 的 tool_call payload 由 Mastra 内部生成，我们无法直接在 tool execute 内修改 tool_call 的 payload。

**替代方案**：前端在收到 `tool_call`（type: mastra_workspace_execute_command）时，自动调用 `GET /api/v1/exec-approvals/pending` 获取最新的 pending 审批记录，展示审批 UI。由于同一时刻 pending 审批数量很少，这是实用的方案。

- [ ] **Step 3: Commit**（前端变更）

---

### Task 10: 端到端验证

- [ ] **Step 1: 启动开发环境**

```bash
pnpm dev
```

- [ ] **Step 2: 创建 Agent 并配置 builtin_tools**

```
POST /api/v1/agents
{
  "name": "Test Agent",
  "builtin_tools": {
    "read": true,
    "write": true,
    "exec": { "enabled": true, "need_approval": true }
  }
}
```

- [ ] **Step 3: 测试 read 工具**

通过聊天发送 "read the file package.json"，验证 Agent 调用了 `mastra_workspace_read_file` 工具并返回文件内容。

- [ ] **Step 4: 测试 exec 审批流程**

通过聊天发送 "run npm test"，验证：
1. Agent 调用 `mastra_workspace_execute_command`
2. 审批记录写入 `exec_approvals` 表
3. 前端收到 `approval_required` 事件
4. 通过 API 批准后命令执行完成

- [ ] **Step 5: Commit final adjustments**

---

## 实现顺序汇总

| 顺序 | 任务 | 依赖 |
|------|------|------|
| 1 | DB 迁移 | 无 |
| 2 | 类型定义 | 1 |
| 3 | AgentManager 更新 | 2 |
| 4 | BuiltinToolManager 重构 | 1, 2 |
| 5 | agent-tool.factory 集成 | 4 |
| 6 | chat.ts 集成 | 4 |
| 7 | 审批 API | 1 |
| 8 | SSE 通知 | 4 |
| 9 | Web 端审批 UI | 7, 8 |
| 10 | 端到端验证 | 1-9 |
