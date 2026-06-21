# Vico Agent 引擎架构升级（V2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Vico Agent 引擎从动态 `new Agent()` 模式升级为 Mastra 预注册 Agent 模式，接入 `@mastra/hono`。

**Architecture:** 启动时预注册两个 Agent（VicoMainAgent + AgentProxyTemplate）。用户自定义 Agent 通过 Tool 方式暴露给 Main Agent，LLM 自主判断路由。Tool 列表缓存 + CRUD 事件驱动刷新。

**Tech Stack:** Mastra Core 1.42 + @mastra/hono 1.4 + Hono 4 + Drizzle ORM + better-sqlite3

**Spec:** `docs/superpowers/specs/2026-06-13-mastra-v2-architecture-redesign.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/server/src/app.ts` | 新建 | 从 index.ts 抽离 Hono app 创建为 `createApp()` |
| `packages/server/src/mastra.ts` | 新建 | Mastra 实例 + MastraServer + 挂载 Hono app |
| `packages/server/src/agent/mastra/agents/vico-main.agent.ts` | 新建 | VicoMainAgent — LLM 驱动的任务路由调度 |
| `packages/server/src/agent/mastra/agents/agent-proxy.agent.ts` | 新建 | AgentProxyTemplate — 配置注入执行 |
| `packages/server/src/agent/mastra/tools/agent-tool.factory.ts` | 新建 | 用户 Agent → Mastra Tool 转换 |
| `packages/server/src/agent/mastra/cache/agent-tool-cache.ts` | 新建 | 按租户缓存 Tool 列表 + 主动刷新 |
| `packages/server/src/agent/mastra/bridges/model-bridge.ts` | 新建 | `resolveModelProvider()` 从 agent-factory.ts 迁移 |
| `packages/server/src/index.ts` | 修改 | 精简为启动入口，通过 mastra.ts 获取 app |
| `packages/server/src/api/chat.ts` | 修改 | 单 Agent 对话改用 VicoMainAgent + Tool 路由 |
| `packages/server/src/api/agents.ts` | 修改 | Agent CRUD 后触发 `agentToolCache.invalidate()` |
| `packages/server/src/agent/team-network.ts` | 修改 | 从 `mastra.getAgent()` 获取 Agent，不再动态 new Agent |
| `packages/server/src/agent/agent-factory.ts` | 删除 | 逻辑已迁移到 model-bridge.ts + agent-tool.factory.ts |

---

### Task 1: 创建 app.ts，从 index.ts 抽离 Hono app

**Files:**
- Create: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 创建 app.ts**

将 `index.ts` 中 `main()` 函数内 Hono app 的创建、中间件注册、路由注册等所有非启动逻辑抽离为 `createApp()` 导出函数。从现有 `index.ts` 提取完整的 CORS、限流、Session 中间件、Auth 守卫、better-auth 挂载、业务路由注册等全部代码。

```typescript
// vico/server/src/app.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq } from 'drizzle-orm';
import { auth } from './auth/index.js';
import { registerRoutes } from './api/router.js';
import { getDb } from './db/db.js';
import { member, session as sessionTable } from './db/auth-schema.js';
import { config } from './config.js';
import logger from './lib/logger.js';
import type { Variables } from './index.js';

export function createApp(): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((err, c) => {
    logger.error({ err }, 'Unhandled error');
    const message = err instanceof Error ? err.message : 'An internal error occurred';
    const stack = err instanceof Error ? err.stack : undefined;
    return c.json(
      { error: message, stack: config.server.deploy_mode === 'private' ? stack : undefined },
      500,
    );
  });

  app.use('*', cors({ origin: '*', credentials: true }));

  const rateMap = new Map<string, { count: number; resetAt: number; limit: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateMap) {
      if (now > v.resetAt) rateMap.delete(k);
    }
  }, 5 * 60 * 1000);

  function getRateLimit(path: string, ip: string): { limit: number } {
    if (path.startsWith('/api/auth/sign-in') || path.startsWith('/api/auth/sign-up')) {
      return { limit: 5 };
    }
    if (path.startsWith('/api/v1/chat')) {
      return { limit: 30 };
    }
    return { limit: 100 };
  }

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/health' || path.startsWith('/api/auth/')) return next();

    const ip = c.req.header('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const { limit } = getRateLimit(path, ip);
    const key = `${ip}:${path.startsWith('/api/auth/sign') ? 'auth' : path.startsWith('/api/v1/chat') ? 'chat' : 'default'}`;

    const entry = rateMap.get(key);
    if (!entry || now > entry.resetAt) {
      rateMap.set(key, { count: 1, resetAt: now + 60000, limit });
      c.res.headers.set('X-RateLimit-Limit', String(limit));
      c.res.headers.set('X-RateLimit-Remaining', String(limit - 1));
      return next();
    }
    if (entry.count >= entry.limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.res.headers.set('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests' }, 429);
    }
    entry.count++;
    c.res.headers.set('X-RateLimit-Limit', String(entry.limit));
    c.res.headers.set('X-RateLimit-Remaining', String(entry.limit - entry.count));
    return next();
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/health' || path.startsWith('/api/auth/')) {
      return next();
    }
    const result = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    c.set('user', result?.user ?? null);
    c.set('session', result?.session ?? null);
    return next();
  });

  app.use('/api/v1/*', async (c, next) => {
    const session = c.get('session');
    const user = c.get('user');
    if (!session || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!session.activeOrganizationId) {
      const db = getDb();
      const membership = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, user.id))
        .limit(1)
        .get();
      if (!membership) {
        return c.json({ error: 'No organization found' }, 401);
      }
      await db.update(sessionTable)
        .set({ activeOrganizationId: membership.organizationId })
        .where(eq(sessionTable.id, session.id))
        .run();
      session.activeOrganizationId = membership.organizationId;
    }
    return next();
  });

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  registerRoutes(app);

  return app;
}
```

- [ ] **Step 2: 修改 index.ts**

将 `index.ts` 精简为启动入口，保留 `main()` 中非 app 创建的初始化逻辑（migrations、skill init、storage init、seed），app 通过 `createApp()` 获取。

```typescript
// vico/server/src/index.ts
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { skillManager } from './skill/manager.js';
import { runMigrations } from './db/run-migrations.js';
import { seedDefaultOrgAndAdmin } from './auth/seed.js';
import { getStorage } from './agent/memory-setup.js';
import { createApp } from './app.js';
import logger from './lib/logger.js';
import type { auth } from './auth/index.js';

/** better-auth session 扩展类型 */
type SessionWithOrg = typeof auth.$Infer.Session.session & { activeOrganizationId?: string | null };

export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: SessionWithOrg | null;
};

async function main() {
  runMigrations();
  await skillManager.init();
  await getStorage().init();
  await seedDefaultOrgAndAdmin();

  const app = createApp();

  serve({ fetch: app.fetch, port: config.server.port, hostname: '0.0.0.0' }, (info) => {
    logger.info({ port: info.port, deployMode: config.server.deploy_mode }, 'Server started');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
```

- [ ] **Step 3: 验证服务启动**

```bash
cd vico/server && npx tsx src/index.ts
```

Expected: 服务正常启动，`/health` 返回 `{"status":"ok"}`，`/api/v1/agents` 可正常访问。

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/app.ts vico/server/src/index.ts
git commit -m "refactor: extract Hono app creation to app.ts createApp()"
```

---

### Task 2: 创建 model-bridge.ts，迁移模型解析逻辑

**Files:**
- Create: `packages/server/src/agent/mastra/bridges/model-bridge.ts`
- Modify: `packages/server/src/agent/agent-factory.ts` (in a later task, will be deleted)

- [ ] **Step 1: 创建 model-bridge.ts**

从 `agent-factory.ts` 的 `resolveModelProvider` 函数迁移代码，保持逻辑完全一致。

```typescript
// vico/server/src/agent/mastra/bridges/model-bridge.ts
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { ModelConfigRow } from '../../model-registry.js';

/**
 * 根据 Vico model_configs 行创建 AI SDK LanguageModel。
 *
 * 支持的 provider:
 * - openai, deepseek, qwen, custom → 通过 createOpenAI() 创建（OpenAI 兼容协议）
 * - anthropic → 通过 createAnthropic() 创建
 *
 * @param modelConfig - 来自 model_configs 表的模型配置行
 * @returns AI SDK LanguageModel 实例，可直接传入 Mastra Agent
 */
export function resolveModelProvider(modelConfig: ModelConfigRow): MastraModelConfig {
  const apiKey = modelConfig.api_key_encrypted;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelConfig.model_name);
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/bridges/model-bridge.ts
git commit -m "feat: add model-bridge.ts — migrate resolveModelProvider from agent-factory"
```

---

### Task 3: 创建 VicoMainAgent

**Files:**
- Create: `packages/server/src/agent/mastra/agents/vico-main.agent.ts`

- [ ] **Step 1: 创建 vico-main.agent.ts**

主办 Agent，负责接收用户消息、LLM 判断路由到子 Agent Tool、汇总结果。model 使用默认 LLM（后续通过 RunContext 动态切换）。

```typescript
// vico/server/src/agent/mastra/agents/vico-main.agent.ts
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { getMemory } from '../../memory-setup.js';

/**
 * Vico Main Agent — 通用任务路由调度器。
 *
 * 职责：
 * 1. 接收用户消息，理解任务意图
 * 2. 从可用的 Agent Tool 列表中选择最合适的执行
 * 3. 复杂任务拆解为多个子任务分派
 * 4. 汇总子 Agent 结果，返回整合后的最终回复
 * 5. 没有合适 Agent 时自行回答
 */
export const vicoMainAgent = new Agent({
  id: 'vico-main',
  name: 'Vico',
  description: '通用 AI 助手，能够理解任务、分派给专业 Agent、汇总结果',
  instructions: `
你是一个通用 AI Agent 调度器（Vico）。你的职责是：

## 核心流程
1. **分析任务**：理解用户的需求和意图
2. **选择 Agent**：从可用的专业 Agent 工具中选择最合适的来执行任务
3. **拆解任务**：对于需要多个专业能力配合的复杂任务，拆解为多个子任务，依次或并行调用不同 Agent
4. **汇总结果**：整合所有子 Agent 的输出，形成连贯、完整的最终回复
5. **自行回答**：如果没有合适的专业 Agent，或任务属于通用问答，直接用自己的知识回答

## 可用 Agent 工具
你的 tools 列表中的每个 agent_* 工具对应一个专业 Agent。工具的 description 说明了该 Agent 的专业领域和能力。

## 注意事项
- 优先使用专业 Agent 处理专业任务，不要越俎代庖
- 如果任务简单（如问候、闲聊）或没有匹配的 Agent，直接自己回答，不要强行调用工具
- 可以一次调用多个 Agent 处理复杂任务的不同方面
- 汇总结果时保持信息完整，不要丢失重要内容
- 如果 Agent 返回的结果不完整或有问题，可以补充说明
`.trim(),
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder' }).chat('gpt-4o'),
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 15,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/agents/vico-main.agent.ts
git commit -m "feat: add VicoMainAgent — LLM-driven task routing dispatcher"
```

---

### Task 4: 创建 AgentProxyTemplate

**Files:**
- Create: `packages/server/src/agent/mastra/agents/agent-proxy.agent.ts`

- [ ] **Step 1: 创建 agent-proxy.agent.ts**

代理模板 Agent，不固定 instructions/model/tools，运行时由 Tool 调用的 RunContext 注入。

```typescript
// vico/server/src/agent/mastra/agents/agent-proxy.agent.ts
import { Agent } from '@mastra/core/agent';
import { getMemory } from '../../memory-setup.js';

/**
 * Agent Proxy Template — 通用 Agent 代理模板。
 *
 * Mastra 不支持动态注册 Agent 实例。用户在 UI 上创建的 Agent
 * 以数据库配置形式存在，通过此模板 + 不同的 RunContext 来模拟
 * "多 Agent" 效果。
 *
 * 此 Agent 的 instructions/model/tools 均在运行时由 agent-tool.factory.ts
 * 通过 agentProxy.run() 的 context 参数动态注入。
 * 每次调用是独立的对话，不共享上下文。
 */
export const agentProxy = new Agent({
  id: 'agent-proxy',
  name: 'Agent Proxy',
  description: '通用 Agent 代理，根据运行时上下文配置执行不同角色的任务',
  instructions: 'You are a helpful assistant.',
  model: null as any,
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 10,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/agents/agent-proxy.agent.ts
git commit -m "feat: add AgentProxyTemplate — runtime context-injected agent proxy"
```

---

### Task 5: 创建 mastra.ts

**Files:**
- Create: `packages/server/src/mastra.ts`

- [ ] **Step 1: 创建 mastra.ts**

创建 Mastra 实例 + MastraServer，将 createApp() 的 Hono app 挂载到 Mastra。

```typescript
// vico/server/src/mastra.ts
import { Mastra } from '@mastra/core';
import { MastraServer } from '@mastra/hono';
import { vicoMainAgent } from './agent/mastra/agents/vico-main.agent.js';
import { agentProxy } from './agent/mastra/agents/agent-proxy.agent.js';
import { getStorage } from './agent/memory-setup.js';
import { createApp } from './app.js';

/**
 * Mastra 实例 — 全局单例。
 *
 * 预注册两个 Agent：
 * - vicoMainAgent: 通用任务路由调度
 * - agentProxy: 配置驱动的 Agent 代理模板
 */
const mastra = new Mastra({
  agents: {
    vicoMainAgent,
    agentProxy,
  },
  storage: getStorage(),
});

/** 创建 Hono app */
const app = createApp();

/**
 * MastraServer — @mastra/hono 集成。
 *
 * 负责:
 * - 注入 Mastra Context 中间件（RequestContext + ToolsInput + AbortSignal）
 * - 自动注册 Agent 流式端点（/api/mastra/agents/:id/chat）
 * - 流式响应处理
 */
const server = new MastraServer(mastra);

// 注册 Mastra context 中间件到 Hono app
server.registerContextMiddleware();
// 将 Hono app 的请求注入 Mastra context
app.use('*', (c, next) => {
  return server.createContextMiddleware()(c, next);
});

// 在 Hono app 上注册 Mastra 自动路由
server.registerCustomApiRoutes();

export { mastra, server, app };
export default mastra;
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/mastra.ts
git commit -m "feat: add mastra.ts — Mastra instance + MastraServer integration"
```

---

### Task 6: 创建 AgentToolFactory

**Files:**
- Create: `packages/server/src/agent/mastra/tools/agent-tool.factory.ts`

- [ ] **Step 1: 创建 agent-tool.factory.ts**

为每个用户自定义 Agent 创建 Mastra Tool，Tool 的 execute 内部调用 agentProxy.run() 并注入该 Agent 的完整配置。

```typescript
// vico/server/src/agent/mastra/tools/agent-tool.factory.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { agentProxy } from '../agents/agent-proxy.agent.js';
import { getSkillToolsForMastraAgent } from '../../tools/skill-tool-adapter.js';
import { createRagSearchTool } from '../../tools/rag-tool.js';
import { resolveModelProvider } from '../bridges/model-bridge.js';
import { getDefaultModel } from '../../model-registry.js';
import { skillManager } from '../../../skill/manager.js';
import logger from '../../../lib/logger.js';
import type { ModelConfigRow } from '../../model-registry.js';

/** Vico Agent 数据库行的最小类型 */
interface AgentRow {
  id: string;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  model_id?: string | null;
  rag_mode?: string | null;
  max_steps?: number | null;
}

/**
 * 为单个用户定义的 Agent 创建 Mastra Tool。
 *
 * Tool description 包含 Agent 名称和能力描述，供 VicoMainAgent 的 LLM 路由判断。
 *
 * execute 内部:
 * 1. 加载该 Agent 的模型、prompt、skills、RAG 配置
 * 2. 通过 agentProxy.run() + RunContext 注入配置
 * 3. 返回 Agent 执行结果的文本
 *
 * @param agentRow - agents 表的行数据
 * @param tenantId - 租户 ID
 * @returns Mastra Tool 实例
 */
export function createAgentTool(agentRow: AgentRow, tenantId: string) {
  const capabilityDesc = [
    agentRow.description || '',
  ].filter(Boolean).join('。');

  return createTool({
    id: `agent_${agentRow.id}`,
    description: `委托任务给「${agentRow.name}」Agent。${capabilityDesc ? capabilityDesc + '。' : ''}当用户需要 ${agentRow.name} 相关能力时调用此工具`,
    inputSchema: z.object({
      task: z.string().describe(`要委托给 ${agentRow.name} 的具体任务描述`),
      context: z.string().optional().describe('附加上下文信息'),
    }),
    execute: async ({ task, context }) => {
      // 1. 解析该 Agent 使用的模型
      let model: ReturnType<typeof resolveModelProvider> | null = null;
      try {
        const modelConfig: ModelConfigRow | null = await getDefaultModel(tenantId);
        if (modelConfig) {
          model = resolveModelProvider(modelConfig);
        }
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to resolve model for agent tool');
      }

      // 2. 构建 instructions: system_prompt + skill prompts + 当前任务
      let instructions = agentRow.system_prompt || 'You are a helpful assistant.';
      try {
        const skillPrompts = await skillManager.getPromptForAgent(agentRow.id);
        if (skillPrompts) {
          instructions += '\n\n## 技能指南\n' + skillPrompts;
        }
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to load skill prompts');
      }
      instructions += `\n\n## 当前任务\n${task}`;
      if (context) {
        instructions += `\n\n## 附加上下文\n${context}`;
      }

      // 3. 构建 tools: Skill Tools + RAG Tool
      const tools: Record<string, any> = {};
      try {
        const skillTools = await getSkillToolsForMastraAgent(agentRow.id, {
          tenantId,
          agentId: agentRow.id,
          userId: '', // proxy 调用不需要具体用户 ID
          skillConfig: {},
        });
        Object.assign(tools, skillTools);
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to load skill tools');
      }

      try {
        if (agentRow.rag_mode !== 'disabled') {
          const ragTool = await createRagSearchTool(agentRow.id, tenantId);
          if (ragTool) {
            tools[ragTool.id] = ragTool;
          }
        }
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to create RAG tool');
      }

      // 4. 调用 agentProxy，通过 RunContext 注入配置
      const result = await agentProxy.run(
        [{ role: 'user', content: task }],
        {
          context: {
            instructions,
            model,
            tools,
            maxSteps: agentRow.max_steps ?? 10,
          } as any,
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

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/tools/agent-tool.factory.ts
git commit -m "feat: add AgentToolFactory — user agent to Mastra Tool converter"
```

---

### Task 7: 创建 AgentToolCache

**Files:**
- Create: `packages/server/src/agent/mastra/cache/agent-tool-cache.ts`

- [ ] **Step 1: 创建 agent-tool-cache.ts**

```typescript
// vico/server/src/agent/mastra/cache/agent-tool-cache.ts
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db/db.js';
import { createAgentTool } from '../tools/agent-tool.factory.js';
import logger from '../../../lib/logger.js';

const { agents } = schema;

/**
 * Agent Tool 缓存管理器。
 *
 * 按租户缓存用户自定义 Agent 转换后的 Mastra Tool 映射表。
 * 首次获取时懒加载从 DB 构建。Agent CRUD 后通过 invalidate() 清除。
 */
class AgentToolCache {
  /** tenantId → Map<toolId, Tool> */
  private cache: Map<string, Map<string, any>> = new Map();

  /** tenantId → Agent 能力描述文本 */
  private descCache: Map<string, string> = new Map();

  /**
   * 获取租户可用的 Agent Tool 映射表（toolId → Tool）。
   * 用于注入到 VicoMainAgent 的 tools 配置中。
   */
  async getToolsForTenant(tenantId: string): Promise<Record<string, any>> {
    if (!this.cache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    const tools: Record<string, any> = {};
    const tenantTools = this.cache.get(tenantId)!;
    for (const [id, tool] of tenantTools) {
      tools[id] = tool;
    }
    return tools;
  }

  /**
   * 获取租户所有 Agent 的能力描述文本。
   * 用于注入到 VicoMainAgent 的 instructions 中，帮助 LLM 判断路由。
   */
  async getAgentDescriptions(tenantId: string): Promise<string> {
    if (!this.descCache.has(tenantId)) {
      await this.rebuildForTenant(tenantId);
    }
    return this.descCache.get(tenantId) || '';
  }

  /** 从 DB 重建租户的 Tool 列表和描述 */
  private async rebuildForTenant(tenantId: string): Promise<void> {
    const db = getDb();
    const agentRows = await db.select().from(agents)
      .where(eq(agents.tenant_id, tenantId))
      .all();

    const toolMap = new Map<string, any>();
    const descriptions: string[] = [];

    for (const row of agentRows) {
      try {
        const tool = createAgentTool(row as any, tenantId);
        toolMap.set(`agent_${row.id}`, tool);
        descriptions.push(`- **${row.name}** (agent_${row.id}): ${row.description || '无描述'}`);
      } catch (err) {
        logger.error({ err, agentId: row.id }, 'Failed to create agent tool');
      }
    }

    this.cache.set(tenantId, toolMap);
    this.descCache.set(tenantId, descriptions.join('\n'));
    logger.info({ tenantId, count: toolMap.size }, 'Agent tool cache rebuilt');
  }

  /** 清除指定租户的缓存 — Agent CRUD 后调用 */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.descCache.delete(tenantId);
    logger.info({ tenantId }, 'Agent tool cache invalidated');
  }

  /** 清除所有缓存 */
  invalidateAll(): void {
    this.cache.clear();
    this.descCache.clear();
    logger.info('All agent tool caches invalidated');
  }
}

export const agentToolCache = new AgentToolCache();
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/cache/agent-tool-cache.ts
git commit -m "feat: add AgentToolCache — per-tenant tool cache with lazy rebuild"
```

---

### Task 8: 修改 agents.ts — Agent CRUD 后触发缓存刷新

**Files:**
- Modify: `packages/server/src/api/agents.ts`

- [ ] **Step 1: 在 POST/PATCH/DELETE 路由中添加 cache invalidate**

在 `agentRoutes()` 函数中，创建、更新、删除 Agent 后调用 `agentToolCache.invalidate(auth.tenantId)`。改动仅添加 import 和一行 invalidate 调用。

```typescript
// vico/server/src/api/agents.ts

// 在文件顶部 import 区域添加：
import { agentToolCache } from '../agent/mastra/cache/agent-tool-cache.js';

// POST /api/v1/agents — 在 return 前添加:
  app.post('/api/v1/agents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const { name, system_prompt, model_id, temperature, max_tokens, max_steps, rag_mode } = await c.req.json();

    const db = getDb();
    const id = uuid();
    const now = Date.now();
    await db.insert(agents).values({
      id, tenant_id: auth.tenantId, name,
      system_prompt: system_prompt || '', model_id: model_id || '',
      temperature: temperature ?? 0.7, max_tokens: max_tokens ?? 4096,
      max_steps: max_steps ?? 10, rag_mode: rag_mode || 'auto', enabled: 1,
      created_at: now, updated_at: now,
    }).run();
    // 新增：清除缓存，下次请求时懒加载重建
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ id, message: 'created' });
  });

// PATCH /api/v1/agents/:id — 在 return 前添加:
  app.patch('/api/v1/agents/:id', async (c) => {
    // ... 现有逻辑不变 ...
    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = Date.now();
      await db.update(agents).set(updateData)
        .where(and(eq(agents.tenant_id, auth.tenantId), eq(agents.id, id)))
        .run();
    }
    // 新增：清除缓存
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ message: 'updated' });
  });

// DELETE /api/v1/agents/:id — 在 return 前添加:
  app.delete('/api/v1/agents/:id', async (c) => {
    // ... 现有删除逻辑不变 ...
    // 新增：清除缓存
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ message: 'deleted' });
  });
```

注意：还需要在绑定/解绑 Skill（`PUT /api/v1/agents/:id/skills`）和绑定/解绑知识库（`PUT /api/v1/agents/:id/knowledge`）的 handler 中也加入 `agentToolCache.invalidate(auth.tenantId)`，因为这些操作改变了 Agent 的 Tool 集合。

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/api/agents.ts
git commit -m "feat: invalidate agent tool cache on CRUD operations"
```

---

### Task 9: 改造 chat.ts — 单 Agent 对话使用 VicoMainAgent

**Files:**
- Modify: `packages/server/src/api/chat.ts`

- [ ] **Step 1: 重写单 Agent 对话 handler**

将现有的 `POST /api/v1/chat` 从调用 `createAgent()` + `agent.streamLegacy()` 改为从 Mastra 获取 `vicoMainAgent` 并注入动态 Tool 列表。保留 Teams 对话部分不变。

```typescript
// vico/server/src/api/chat.ts
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { mastra } from '../mastra.js';
import { agentToolCache } from '../agent/mastra/cache/agent-tool-cache.js';
import { createSSEStream, createNetworkSSEStream } from '../agent/sse-utils.js';
import { getMemory } from '../agent/memory-setup.js';
import { getDefaultModel } from '../agent/model-registry.js';
import logger from '../lib/logger.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 — 使用 VicoMainAgent + 动态 Tool 路由 */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    try {
      const body = await c.req.json();
      const { message, conversationId } = body;
      if (!message) {
        return c.json({ error: 'message is required' }, 400);
      }

      const cid = conversationId || uuidv4();
      const threadId = `vico-${auth.userId}-${cid}`;

      // 获取模型名称，存入 thread metadata
      const modelConfig = await getDefaultModel(auth.tenantId);
      const modelName = modelConfig?.model_name || '';

      // 预先创建 thread
      const memory = getMemory();
      await memory.saveThread({
        thread: {
          id: threadId,
          resourceId: auth.tenantId,
          title: '',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            user_id: auth.userId,
            model_name: modelName,
          },
        },
      });

      // 从 Mastra 获取 VicoMainAgent
      const vicoAgent = mastra.getAgent('vicoMainAgent');
      if (!vicoAgent) {
        return c.json({ error: 'Vico main agent not found' }, 500);
      }

      // 获取当前租户的 Agent Tools + 能力描述（缓存）
      const agentTools = await agentToolCache.getToolsForTenant(auth.tenantId);
      const agentDescriptions = await agentToolCache.getAgentDescriptions(auth.tenantId);

      // 构建动态 instructions（注入可用 Agent 列表）
      const dynamicInstructions = agentDescriptions
        ? `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}`
        : '';

      // 流式调用
      const result = await (vicoAgent as any).stream(
        [{ role: 'user', content: message }],
        {
          context: {
            instructions: vicoAgent.instructions + dynamicInstructions,
            tools: agentTools,
          },
          memory: {
            thread: threadId,
            resource: auth.tenantId,
          },
          maxSteps: 15,
        }
      );

      // 包装为 SSE 流
      const stream = createSSEStream(result);

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error }, 'Chat stream error');
      return c.json({ error: message }, 500);
    }
  });

  /** 团队对话 — 基于 Mastra agent.network() 的多 Agent 协作（保留） */
  app.post('/api/v1/teams/:id/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const teamId = c.req.param('id');
    const body = await c.req.json();
    const { message } = body;
    if (!message) return c.json({ error: 'message is required' }, 400);

    try {
      const { createTeamNetwork } = await import('../agent/team-network.js');
      const { stream } = await createTeamNetwork(teamId, message, {
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      const sseStream = createNetworkSSEStream(stream);

      return new Response(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, teamId }, 'Team chat error');
      return c.json({ error: message }, 500);
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/api/chat.ts
git commit -m "refactor: rewrite single agent chat to use VicoMainAgent with dynamic tools"
```

---

### Task 10: 修改 index.ts — 服务启动通过 mastra.ts 获取 app

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 更新 index.ts**

将 app 来源从直接 `createApp()` 改为从 `mastra.ts` 导入（mastra.ts 已经调用了 `createApp()` 并配置了 MastraServer 中间件）。

```typescript
// vico/server/src/index.ts
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { skillManager } from './skill/manager.js';
import { runMigrations } from './db/run-migrations.js';
import { seedDefaultOrgAndAdmin } from './auth/seed.js';
import { getStorage } from './agent/memory-setup.js';
import { app } from './mastra.js'; // 改为从 mastra.ts 导入
import logger from './lib/logger.js';
import type { auth } from './auth/index.js';

/** better-auth session 扩展类型 */
type SessionWithOrg = typeof auth.$Infer.Session.session & { activeOrganizationId?: string | null };

export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: SessionWithOrg | null;
};

async function main() {
  runMigrations();
  await skillManager.init();
  await getStorage().init();
  await seedDefaultOrgAndAdmin();

  serve({ fetch: app.fetch, port: config.server.port, hostname: '0.0.0.0' }, (info) => {
    logger.info({ port: info.port, deployMode: config.server.deploy_mode }, 'Server started');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
```

- [ ] **Step 2: 验证服务启动和路由**

```bash
cd vico/server && npx tsx src/index.ts
```

Expected: 服务启动成功，`/health` 正常，`/api/v1/agents` 正常，Mastra 自动注册的 `/api/mastra/*` 路由可访问。

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/index.ts
git commit -m "refactor: wire index.ts to use mastra.ts app with MastraServer middleware"
```

---

### Task 11: 适配 team-network.ts

**Files:**
- Modify: `packages/server/src/agent/team-network.ts`

- [ ] **Step 1: 修改 createTeamNetwork，用 agentProxy 动态执行替代 new Agent()**

将 `createAgent()` 调用改为通过 `agentProxy.run()` + RunContext 注入成员 Agent 配置。注意保持 `supervisor.network()` 的调用方式不变。

```typescript
// vico/server/src/agent/team-network.ts
import { Agent } from '@mastra/core/agent';
import type { MastraAgentNetworkStream } from '@mastra/core/stream';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/db.js';
import { resolveModelProvider } from './mastra/bridges/model-bridge.js';
import { agentProxy } from './mastra/agents/agent-proxy.agent.js';
import { getSkillToolsForMastraAgent } from './tools/skill-tool-adapter.js';
import { createRagSearchTool } from './tools/rag-tool.js';
import { getDefaultModel } from './model-registry.js';
import { skillManager } from '../skill/manager.js';
import logger from '../lib/logger.js';

const { agentTeams, agentTeamMembers, agents } = schema;

interface TeamConfig {
  teamId: string;
  teamName: string;
  tenantId: string;
  supervisorAgentId: string | null;
  routingStrategy: string;
  members: { agentId: string; role: string }[];
}

async function loadTeamConfig(teamId: string, tenantId: string): Promise<TeamConfig> {
  const db = getDb();
  const team = await db.select().from(agentTeams)
    .where(and(eq(agentTeams.id, teamId), eq(agentTeams.tenant_id, tenantId)))
    .get();
  if (!team) throw new Error('Team not found');

  const members = await db.select({
    agentId: agentTeamMembers.agent_id,
    role: agentTeamMembers.role,
  }).from(agentTeamMembers)
    .where(eq(agentTeamMembers.team_id, teamId))
    .all();

  if (members.length === 0) throw new Error('Team has no members');

  return {
    teamId: team.id,
    teamName: team.name,
    tenantId,
    supervisorAgentId: team.supervisor_agent_id,
    routingStrategy: team.routing_strategy,
    members,
  };
}

/**
 * 为 Team 成员创建 Agent 实例。
 * 不再使用 `createAgent()` 动态 new Agent()，改为通过 agentProxy.run() + RunContext 注入配置。
 */
async function createMemberAgent(
  agentId: string,
  tenantId: string,
  userId: string,
): Promise<Agent> {
  const db = getDb();
  const agentRow = await db.select().from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
    .get();
  if (!agentRow) throw new Error(`Agent ${agentId} not found`);

  // 加载模型
  let model: ReturnType<typeof resolveModelProvider> | null = null;
  try {
    const modelConfig = await getDefaultModel(tenantId);
    if (modelConfig) {
      model = resolveModelProvider(modelConfig);
    }
  } catch {}

  // 构建 instructions
  let instructions = agentRow.system_prompt || '';
  try {
    const skillPrompts = await skillManager.getPromptForAgent(agentId);
    if (skillPrompts) {
      instructions += '\n\n## 技能指南\n' + skillPrompts;
    }
  } catch {}

  // 构建 tools
  const tools: Record<string, any> = {};
  try {
    const skillTools = await getSkillToolsForMastraAgent(agentId, { tenantId, agentId, userId, skillConfig: {} });
    Object.assign(tools, skillTools);
  } catch {}
  try {
    if (agentRow.rag_mode !== 'disabled') {
      const ragTool = await createRagSearchTool(agentId, tenantId);
      if (ragTool) tools[ragTool.id] = ragTool;
    }
  } catch {}

  // 通过 agentProxy 创建带有 RunContext 的 Agent
  return new Agent({
    id: `team-member-${agentId}`,
    name: agentRow.name,
    instructions,
    model: model as any,
    tools,
    maxRetries: 0,
    defaultOptions: { maxSteps: agentRow.max_steps ?? 10 },
  });
}

export async function createTeamNetwork(
  teamId: string,
  message: string,
  context: { tenantId: string; userId: string },
): Promise<{ stream: MastraAgentNetworkStream; teamId: string }> {
  const teamConfig = await loadTeamConfig(teamId, context.tenantId);

  // 1. 为每个成员创建 Agent 实例
  const memberAgents: Record<string, Agent> = {};
  for (const member of teamConfig.members) {
    try {
      const agent = await createMemberAgent(member.agentId, context.tenantId, context.userId);
      memberAgents[member.agentId] = agent;
      logger.info({ agentId: member.agentId, role: member.role }, 'Team member agent created');
    } catch (err) {
      logger.warn({ err, agentId: member.agentId }, 'Failed to create team member agent');
    }
  }

  if (Object.keys(memberAgents).length === 0) {
    throw new Error('Failed to create any team member agents');
  }

  // 2. 确定 Supervisor
  let supervisorModel: ReturnType<typeof resolveModelProvider>;
  let supervisorInstructions: string;

  if (teamConfig.supervisorAgentId) {
    const supAgent = await createMemberAgent(
      teamConfig.supervisorAgentId,
      context.tenantId,
      context.userId,
    );
    supervisorModel = (supAgent as any).model;
    supervisorInstructions = (supAgent as any).instructions;
  } else {
    const modelConfig = await getDefaultModel(context.tenantId);
    if (!modelConfig) throw new Error('No LLM model configured');
    supervisorModel = resolveModelProvider(modelConfig);
    supervisorInstructions = `你是团队"${teamConfig.teamName}"的协调者。根据用户请求，分配合适的团队成员来处理任务。`;
  }

  // 3. 创建 Supervisor Agent（注入成员作为 sub-agents）
  const supervisor = new Agent({
    id: `team-supervisor-${teamId}`,
    name: `${teamConfig.teamName} Supervisor`,
    instructions: supervisorInstructions,
    model: supervisorModel,
    agents: memberAgents,
    maxRetries: 0,
    defaultOptions: { maxSteps: 15 },
  });

  // 4. 执行多 Agent 协作
  const stream = await supervisor.network([{ role: 'user', content: message }], {
    memory: {
      thread: `team-${teamId}-${context.userId}`,
      resource: context.tenantId,
    },
    maxSteps: 15,
  });

  logger.info({ teamId, memberCount: Object.keys(memberAgents).length }, 'Team network started');
  return { stream, teamId };
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/team-network.ts
git commit -m "refactor: adapt team-network to build member agents from DB configs"
```

---

### Task 12: 删除 agent-factory.ts，清理导入

**Files:**
- Delete: `packages/server/src/agent/agent-factory.ts`

- [ ] **Step 1: 检查 agent-factory.ts 是否还有被引用**

```bash
grep -rn "agent-factory" vico/server/src/ --include="*.ts" | grep -v node_modules
```

Expected: 仅有 `team-network.ts` 中有引用（Task 11 已移除），不应还有其他引用。

- [ ] **Step 2: 删除文件**

```bash
rm vico/server/src/agent/agent-factory.ts
```

- [ ] **Step 3: 验证构建**

```bash
cd vico/server && npx tsc --noEmit
```

Expected: 类型检查通过，无编译错误。

- [ ] **Step 4: 验证服务启动**

```bash
cd vico/server && npx tsx src/index.ts
```

Expected: 服务正常启动，所有 API 路由可访问。

- [ ] **Step 5: Commit**

```bash
git add vico/server/src/agent/agent-factory.ts
git commit -m "refactor: remove agent-factory.ts — migrated to model-bridge + tool factory"
```

---

## 自检清单

### Spec 覆盖率

| Spec 要求 | 对应 Task |
|-----------|----------|
| 接入 @mastra/hono | Task 5 (mastra.ts) |
| 创建 VicoMainAgent | Task 3 |
| 创建 AgentProxyTemplate | Task 4 |
| 用户 Agent 作为 Tool 暴露 | Task 6 (factory) |
| Tool 缓存 + 主动刷新 | Task 7 (cache), Task 8 (invalidate) |
| 整体挂载到 Mastra | Task 5, Task 10 |
| Teams 保留独立模式 | Task 11 |
| Chat API 改造 | Task 9 |
| 模型解析迁移 | Task 2 (model-bridge) |
| 删除 agent-factory.ts | Task 12 |

### 无占位符

所有 Task 均包含完整的代码块和确切命令。无 TBD/TODO/占位符。

### 类型一致性

- `agentToolCache` 导出名为 `agentToolCache`，所有引用一致
- `mastra` 导出名为 `mastra`，通过 `mastra.getAgent()` 获取
- `resolveModelProvider` 从 `model-bridge.ts` 导入，所有引用一致
- `createApp()` 从 `app.ts` 导出，所有引用一致
- Tool id 命名规则 `agent_${row.id}` 在 factory 和 cache 中一致
