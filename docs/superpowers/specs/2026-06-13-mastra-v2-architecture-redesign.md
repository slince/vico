# Vico Agent 引擎架构升级 Spec（V2）

## 概述

基于 `docs/insights/mastra.md` 的纠偏指引，对 Vico Agent 引擎架构进行修正升级。

**核心纠偏：** 当前每次请求动态 `new Agent()` 的方式不符合 Mastra 设计理念。Mastra 要求 Agent 在启动时预注册，不支持运行时动态创建子 Agent。

**升级策略：**
1. 接入 `@mastra/hono`，整体 Hono 应用挂载到 Mastra 实例
2. 预注册两个 Agent：VicoMainAgent（任务路由）+ AgentProxyTemplate（配置注入执行）
3. 用户自定义 Agent 通过 Tool 方式暴露给 Main Agent，由 LLM 自主判断路由
4. Tool 列表缓存 + Agent CRUD 事件驱动刷新

---

## 一、架构变更对比

### 当前（错误）

```
每个 HTTP 请求
  → chat.ts
    → agent-factory.ts
      → SELECT agents FROM DB
      → resolveModel()
      → loadSkills()
      → new Agent({...})        ← 每次动态创建
    → agent.streamLegacy()
    → SSE 响应
```

### 升级后

```
启动时:
  → mastra.ts
    → new Mastra({ agents: { vicoMainAgent, agentProxy } })
    → new MastraServer(mastra, { app })   ← @mastra/hono
    → Hono app 整体挂载

请求时:
  → @mastra/hono 路由
    → VicoMainAgent.stream()
      → LLM 拆解任务 → 选择 agent_X_tool
        → agent_X_tool.execute()
          → AgentProxyTemplate.run(messages, { context: agentConfig })
    → SSE 响应
```

---

## 二、文件变更清单

### 新增文件

```
packages/server/src/
├── mastra.ts                              # Mastra 实例 + @mastra/hono 集成
└── agent/
    └── mastra/
        ├── agents/
        │   ├── vico-main.agent.ts         # VicoMainAgent 定义
        │   └── agent-proxy.agent.ts       # AgentProxyTemplate 定义
        ├── tools/
        │   └── agent-tool.factory.ts      # 用户 Agent → Mastra Tool
        ├── cache/
        │   └── agent-tool-cache.ts        # Tool 列表缓存 + 刷新
        └── bridges/
            ├── model-bridge.ts            # Vico model_configs → AI SDK Model（从 agent-factory.ts 迁移）
            └── auth-bridge.ts             # AuthContext → RunContext 映射

保留（不改）:
packages/server/src/agent/
├── tools/
│   ├── skill-tool-adapter.ts              # 保留：Skill → Mastra Tool 适配
│   └── rag-tool.ts                        # 保留：RAG 工具
├── processors/
│   ├── audit-logger.ts                    # 保留
│   └── token-tracker.ts                   # 保留
├── memory-setup.ts                        # 保留
├── model-registry.ts                      # 保留
├── sse-utils.ts                           # 部分保留（见下）
└── team-network.ts                        # 保留：Teams 独立模式
```

### 待删除/废弃文件

| 文件 | 处理方式 | 原因 |
|------|---------|------|
| `agent/agent-factory.ts` | 删除 | 不再动态创建 Agent，逻辑迁移到 Tool Factory + Proxy |
| `agent/memory/` | 可选删除 | Phase 3 迁移到 Mastra Memory |

### 需修改文件

| 文件 | 变更 |
|------|------|
| `src/index.ts` | 从 `serve()` 改为导出 `app`，由 `mastra.ts` 统一管理 |
| `src/api/chat.ts` | 单 Agent 对话改为从 Mastra 获取 `vicoMainAgent`，通过 Tool 路由 |

---

## 三、核心模块设计

### 3.1 `mastra.ts` — Mastra 实例入口

```typescript
import { Mastra } from '@mastra/core';
import { MastraServer } from '@mastra/hono';
import { vicoMainAgent } from './agent/mastra/agents/vico-main.agent.js';
import { agentProxy } from './agent/mastra/agents/agent-proxy.agent.js';
import { getStorage } from './agent/memory-setup.js';
import { createApp } from './app.js'; // 将 index.ts 中 Hono app 创建抽离
import logger from './lib/logger.js';

// 创建 Mastra 实例，预注册两个 Agent
const mastra = new Mastra({
  agents: {
    vicoMainAgent,
    agentProxy,
  },
  storage: getStorage(),
  logger: {
    level: 'info',
    // ...使用 PinoLogger 封装
  },
});

// 创建 @mastra/hono 集成
const app = createApp(); // 现有 Hono app（含所有 Vico 路由）
const server = new MastraServer(mastra, {
  app,
  // 自动注册 Agent 路由前缀
  agentRoutePrefix: '/api/mastra',
});

export { mastra, server, app };
export default mastra;
```

**关键点：**
- `mastra` 实例在模块加载时创建（单例）
- `MastraServer` 负责将 Hono app 挂载到 Mastra，自动注入 context 中间件
- 自动注册 `/api/mastra/agents/:agentId/chat` 等 Mastra 原生路由

### 3.2 `vico-main.agent.ts` — 默认主 Agent

```typescript
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { getDefaultModel, resolveModelProvider } from '../../model-registry.js';
import { getMemory } from '../../memory-setup.js';
import { agentToolCache } from '../cache/agent-tool-cache.js';

/**
 * Vico Main Agent — 通用任务路由调度器。
 *
 * 职责：
 * 1. 接收用户消息，理解任务意图
 * 2. 从 Tool 列表中选择合适的子 Agent 执行
 * 3. 复杂任务拆解为多个子任务分派
 * 4. 汇总子 Agent 结果，返回最终回复
 * 5. 没有合适 Agent 时自行回答
 *
 * Tool 列表通过 AgentToolCache 动态注入，启动时可用 Agent 描述为空，
 * 实际对话中通过 RunContext 注入当前租户的可用 Agent 描述。
 */
export const vicoMainAgent = new Agent({
  id: 'vico-main',
  name: 'Vico',
  description: '通用 AI 助手，能够理解任务、分派给专业 Agent、汇总结果',
  instructions: `
你是一个通用 AI Agent 调度器（Vico）。你的职责是：

1. **分析任务**：理解用户的需求和意图
2. **选择 Agent**：从可用的专业 Agent 中选择最合适的来执行任务
3. **拆解任务**：对于复杂任务，拆解为多个子任务分别分派
4. **汇总结果**：整合所有子 Agent 的输出，形成连贯的最终回复
5. **自行回答**：如果没有合适的专业 Agent，直接用自己的知识回答

## 可用 Agent 工具

你可以调用以下 Agent 工具来委托任务。每个工具的 description 说明了该 Agent 的专业领域和能力。

## 注意事项
- 优先使用专业 Agent 处理专业任务
- 如果任务简单或没有匹配的 Agent，直接自己回答
- 可以一次调用多个 Agent 处理复杂任务的不同方面
- 汇总结果时保持信息完整，不要丢失重要内容
`.trim(),
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).chat('gpt-4o'),
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 15,
  },
});
```

**关键设计决策：**
- `model` 设为默认模型，但 `AgentProxyTemplate` 的 model 由运行时上下文动态覆盖
- 不使用 `tools` 静态配置，而是在每次 Run 时通过 `RunContext` 注入动态 Tool 列表
- `instructions` 描述调度逻辑，不包含具体 Agent 列表（运行时注入）

### 3.3 `agent-proxy.agent.ts` — 通用 Agent 代理模板

```typescript
import { Agent } from '@mastra/core/agent';
import { getMemory } from '../../memory-setup.js';

/**
 * Agent Proxy Template — 通用 Agent 代理模板。
 *
 * Mastra 不支持动态注册 Agent，因此用户在 UI 上配置的 Agent
 * 作为"配置"存储，请求时通过此模板 + 不同的 RunContext 来执行。
 *
 * 此 Agent 的 instructions/model/tools 均为占位值，
 * 实际值由 agent-tool.factory.ts 在 execute() 中
 * 通过 RunContext 动态注入。
 */
export const agentProxy = new Agent({
  id: 'agent-proxy',
  name: 'Agent Proxy',
  description: '通用 Agent 代理，根据上下文配置执行不同角色的任务',
  instructions: '你是{{agent_name}}。{{agent_instructions}}',
  model: null as any, // 运行时注入
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 10,
  },
});
```

**运行机制：**
- Tool 调用时，`buildAgentRunContext()` 构造包含该 Agent 完整配置的 RunContext
- RunContext 覆盖 `instructions`（注入该 Agent 的 system_prompt）、`model`（注入 Agent 关联的 LLM）、`tools`（注入 Agent 绑定的 Skill Tools）
- 每次调用都是独立对话，不污染其他 Agent 的上下文

### 3.4 `agent-tool.factory.ts` — 用户 Agent 转 Mastra Tool

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { agentProxy } from '../agents/agent-proxy.agent.js';
import { getSkillToolsForMastraAgent } from '../../tools/skill-tool-adapter.js';
import { createRagSearchTool } from '../../tools/rag-tool.js';
import { resolveModelProvider } from '../../model-registry.js';
import type { AgentRow } from '../types.js';

/**
 * 为每个用户自定义 Agent 创建一个 Mastra Tool。
 *
 * Tool 的 description 包含该 Agent 的名称、描述、擅长领域，
 * 供 VicoMainAgent 的 LLM 判断路由。
 *
 * Tool 的 execute() 内部调用 AgentProxyTemplate.run()，
 * 通过 RunContext 动态注入该 Agent 的配置。
 *
 * @param agentRow - 来自 agents 表的 Agent 配置行
 * @param tenantId - 租户 ID
 * @returns Mastra Tool 实例
 */
export function createAgentTool(agentRow: AgentRow, tenantId: string) {
  // 构建 LLM 可读的 Agent 能力描述
  const capabilityDesc = [
    agentRow.description,
    agentRow.skills_summary ? `擅长: ${agentRow.skills_summary}` : '',
  ].filter(Boolean).join('。');

  return createTool({
    id: `agent_${agentRow.id}`,
    description: `委托任务给「${agentRow.name}」Agent。${capabilityDesc}。当用户需要${agentRow.name}的专业能力时调用此工具。`,
    inputSchema: z.object({
      task: z.string().describe(`要委托给 ${agentRow.name} 的具体任务描述，越详细越好`),
      context: z.string().optional().describe('额外的上下文信息，如之前步骤的结果'),
    }),
    execute: async ({ task, context }, { runContext }) => {
      // 1. 加载该 Agent 的模型
      const modelConfig = await getModelForAgent(agentRow, tenantId);
      const model = modelConfig ? resolveModelProvider(modelConfig) : null;

      // 2. 构建 instructions
      let instructions = agentRow.system_prompt || '';
      const skillPrompts = await skillManager.getPromptForAgent(agentRow.id);
      if (skillPrompts) {
        instructions += '\n\n## 技能指南\n' + skillPrompts;
      }
      // 注入从 Main Agent 传来的具体任务
      instructions += `\n\n## 当前任务\n${task}\n${context ? `\n附加上下文:\n${context}` : ''}`;

      // 3. 加载该 Agent 的 Skill Tools + RAG Tool
      const tools: Record<string, any> = {};
      const skillTools = await getSkillToolsForMastraAgent(agentRow.id, { tenantId });
      Object.assign(tools, skillTools);
      if (agentRow.rag_mode !== 'disabled') {
        const ragTool = await createRagSearchTool(agentRow.id, tenantId);
        if (ragTool) tools[ragTool.id] = ragTool;
      }

      // 4. 调用 AgentProxyTemplate
      const result = await agentProxy.run(
        [{ role: 'user', content: task }],
        {
          context: {
            ...runContext,
            instructions,
            model,
            tools,
            maxSteps: agentRow.max_steps ?? 10,
          },
          memory: {
            thread: `proxy-${agentRow.id}-${Date.now()}`,
            resource: tenantId,
          },
        }
      );

      return result.text;
    },
  });
}
```

### 3.5 `agent-tool-cache.ts` — Tool 列表缓存 + 主动刷新

```typescript
import type { Tool } from '@mastra/core/tools';
import { getDb, schema } from '../../../db/db.js';
import { eq } from 'drizzle-orm';
import { createAgentTool } from '../tools/agent-tool.factory.js';
import logger from '../../../lib/logger.js';

const { agents } = schema;

/**
 * Agent Tool 缓存管理器。
 *
 * 按租户缓存用户自定义 Agent 转换后的 Mastra Tool 列表。
 * 当 Agent CRUD 操作发生时，通过 invalidate() 清除对应租户缓存，
 * 下次请求时懒加载重建。
 */
class AgentToolCache {
  /** tenantId → AgentId → Tool */
  private cache: Map<string, Map<string, Tool>> = new Map();

  /**
   * 获取租户的所有 Agent Tools。
   * 首次调用或缓存失效后自动从 DB 重建。
   */
  async getToolsForTenant(tenantId: string): Promise<Record<string, Tool>> {
    if (!this.cache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    const tools: Record<string, Tool> = {};
    const tenantTools = this.cache.get(tenantId)!;
    for (const [id, tool] of tenantTools) {
      tools[id] = tool;
    }
    return tools;
  }

  /** 获取 Agent 能力描述列表（注入到 Main Agent instructions） */
  async getAgentDescriptions(tenantId: string): Promise<string> {
    if (!this.cache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    const db = getDb();
    const agentRows = await db.select().from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .all();
    return agentRows
      .map(r => `- **${r.name}** (id: ${r.id}): ${r.description || '无描述'}`)
      .join('\n');
  }

  /** 从 DB 重建租户的 Tool 列表 */
  private async rebuildForTenant(tenantId: string): Promise<void> {
    const db = getDb();
    const agentRows = await db.select().from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .all();

    const toolMap = new Map<string, Tool>();
    for (const row of agentRows) {
      try {
        const tool = createAgentTool(row, tenantId);
        toolMap.set(`agent_${row.id}`, tool);
      } catch (err) {
        logger.error({ err, agentId: row.id }, 'Failed to create agent tool');
      }
    }
    this.cache.set(tenantId, toolMap);
    logger.info({ tenantId, count: toolMap.size }, 'Agent tool cache rebuilt');
  }

  /** 清除指定租户的缓存（Agent CRUD 后触发） */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    logger.info({ tenantId }, 'Agent tool cache invalidated');
  }

  /** 清除所有缓存 */
  invalidateAll(): void {
    this.cache.clear();
  }
}

export const agentToolCache = new AgentToolCache();
```

### 3.6 触发缓存刷新

在 Agent CRUD 路由中，每次创建/更新/删除 Agent 后调用 `agentToolCache.invalidate(tenantId)`：

```typescript
// api/agents.ts — 示例
import { agentToolCache } from '../agent/mastra/cache/agent-tool-cache.js';

// POST /api/v1/agents
app.post('/api/v1/agents', async (c) => {
  // ...创建 Agent...
  agentToolCache.invalidate(auth.tenantId);
  return c.json(agent, 201);
});

// PUT /api/v1/agents/:id
app.put('/api/v1/agents/:id', async (c) => {
  // ...更新 Agent...
  agentToolCache.invalidate(auth.tenantId);
  return c.json(updated);
});

// DELETE /api/v1/agents/:id
app.delete('/api/v1/agents/:id', async (c) => {
  // ...删除 Agent...
  agentToolCache.invalidate(auth.tenantId);
  return c.json({ success: true });
});
```

---

## 四、Chat API 改造

### 4.1 单 Agent 对话（`/api/v1/chat`）

不再调用 `createAgent()`（废弃），改为：

```typescript
import { mastra } from '../mastra.js';
import { agentToolCache } from '../agent/mastra/cache/agent-tool-cache.js';

app.post('/api/v1/chat', async (c) => {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;

  const { message, conversationId } = await c.req.json();

  // 获取 Main Agent
  const vicoAgent = mastra.getAgent('vicoMainAgent');
  if (!vicoAgent) throw new Error('Vico main agent not found');

  // 获取当前租户的 Agent Tools（缓存）
  const agentTools = await agentToolCache.getToolsForTenant(auth.tenantId);
  const agentDescriptions = await agentToolCache.getAgentDescriptions(auth.tenantId);

  const threadId = `vico-${auth.userId}-${conversationId || uuidv4()}`;

  // 流式调用，动态注入 Tool 列表和 Agent 描述
  const result = await vicoAgent.stream(
    [{ role: 'user', content: message }],
    {
      context: {
        tools: {
          ...agentTools,
          ...skillTools,     // 全局 Skill Tools
          ...ragTool,         // 全局 RAG Tool
        },
        instructions: vicoAgent.instructions + `\n\n## 当前可用 Agent\n${agentDescriptions}`,
      },
      memory: {
        thread: threadId,
        resource: auth.tenantId,
      },
      maxSteps: 15,
    }
  );

  // 使用 @mastra/hono 内置流式处理
  return mastraServer.streamToResponse(c, result);
});
```

### 4.2 Team 对话（`/api/v1/teams/:id/chat`）

保留现有 `team-network.ts` 逻辑不变。Teams 作为独立协作模式存在。

---

## 五、`@mastra/hono` 集成方式

### 启动入口变更

`src/index.ts` 不再直接 `serve()`，改为导出 `createApp()` 函数：

```typescript
// src/app.ts（新增）
export function createApp(): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  // ...所有现有中间件和路由（CORS、限流、auth、业务路由）...
  return app;
}
```

```typescript
// src/mastra.ts
import { Mastra } from '@mastra/core';
import { MastraServer } from '@mastra/hono';
import { createApp } from './app.js';

const app = createApp();
const mastra = new Mastra({ agents: { ... }, storage: getStorage() });
const server = new MastraServer(mastra, { app });

export { mastra, server };
```

```typescript
// src/index.ts（精简）
import { server } from './mastra.js';
import { config } from './config.js';

// MastraServer 自带的 Hono app 直接 serve
serve({ fetch: server.app.fetch, port: config.server.port });
```

### Mastra 提供的自动能力

通过 `@mastra/hono` + MastraServer：
- 自动注入 `RequestContext` 中间件（tenant/locale/timezone 等）
- 自动注册 Agent 流式 chat 端点（`/api/mastra/agents/:id/chat` 等）
- 内置 SSE 流式输出支持
- OpenTelemetry 可观测性追踪

---

## 六、Teams 集成（保留）

Teams 保留现有模式：
- `agent_teams` 表和 `agent_team_members` 表不变
- `team-network.ts` 保留，内部改从 `mastra.getAgent()` 获取成员 Agent
- Team 的 supervisor Agent 也从 Mastra 获取（但不再动态 new Agent，而是 agentProxy 注入配置）

---

## 七、边界约束

### 保留不变的模块

| 模块 | 说明 |
|------|------|
| `skill/` | Skill 加载/管理/绑定逻辑不变 |
| `agent/tools/skill-tool-adapter.ts` | Skill → Mastra Tool 适配不变 |
| `agent/tools/rag-tool.ts` | RAG 工具不变 |
| `agent/processors/` | 审计日志 + Token 跟踪不变 |
| `agent/memory-setup.ts` | Mastra Memory 初始化不变 |
| `agent/model-registry.ts` | 模型配置 CRUD 不变 |
| `agent/team-network.ts` | Teams 协作逻辑保留 |
| `api/agents.ts` | Agent CRUD 路由不变（仅在 write 操作后增加 cache invalidate） |
| `api/skills.ts, models.ts, knowledge.ts` 等 | 全部不变 |

### 删除/废弃的模块

| 模块 | 原因 |
|------|------|
| `agent/agent-factory.ts` | 不再动态 `new Agent()`，逻辑迁移到 `agent-tool.factory.ts` 和 `Agent.run()` context |
| `agent/memory/observational-memory.ts` | 后续由 Mastra Memory 替代（Phase 3） |
| `agent/memory/working-memory.ts` | 后续由 Mastra Memory 替代（Phase 3） |

---

## 八、实施步骤

### Step 1: 基础骨架
1. 将 `index.ts` 中 Hono app 创建抽离为 `app.ts` 的 `createApp()` 函数
2. 创建 `mastra.ts`，Mastra 实例 + MastraServer 集成
3. 修改 `index.ts` 入口，通过 `server.app` 启动
4. 验证：服务启动成功，现有 CRUD 路由正常工作

### Step 2: 两个核心 Agent
1. 实现 `agents/vico-main.agent.ts`
2. 实现 `agents/agent-proxy.agent.ts`
3. 在 `mastra.ts` 中注册两个 Agent
4. 验证：`mastra.getAgent('vicoMainAgent')` 和 `mastra.getAgent('agentProxy')` 可获取

### Step 3: Tool 工厂 + 缓存
1. 实现 `tools/agent-tool.factory.ts` — `createAgentTool()`
2. 实现 `cache/agent-tool-cache.ts` — 缓存 + 刷新
3. 实现 `bridges/model-bridge.ts` — 从 agent-factory.ts 迁移模型解析逻辑
4. 在 Agent CRUD 路由中添加 `agentToolCache.invalidate()` 调用

### Step 4: Chat 改造
1. 重写 `api/chat.ts` 的单 Agent 对话部分
2. 适配 SSE 流式响应格式（确保前端兼容）
3. 验证：单 Agent 对话正常，Tool 路由工作

### Step 5: Teams 适配
1. 修改 `team-network.ts`，从 `mastra.getAgent()` 获取 Agent
2. Supervisor Agent 改用 agentProxy 注入配置
3. 验证：Team 对话正常

### Step 6: 清理
1. 删除 `agent-factory.ts`
2. 将 `sse-utils.ts` 中不再使用的部分标记废弃
3. 全量回归测试

---

## 九、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| `@mastra/hono` API 与预期不符 | 集成方式需调整 | Step 1 先验证 MastraServer 正确挂载，发现问题及时调整 |
| Agent RunContext 覆盖不完整 | Proxy 模板未正确注入配置 | Step 4 重点测试不同 Agent 配置（不同 model/prompt/tools） |
| Tool 缓存与实际状态不一致 | 新增 Agent 不出现或删除 Agent 仍显示 | CRUD 路由中强制 invalidate，必要时加手动刷新 API |
| SSE 格式变化导致前端异常 | 前端对话页面无法正常流式显示 | 保持现有 `text_delta/done/error` 事件格式不变 |
| Teams 模式兼容 | 多 Agent 协作中断 | Teams 独立保留，改动最小化 |
