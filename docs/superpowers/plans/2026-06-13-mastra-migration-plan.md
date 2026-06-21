# Mastra 全栈迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除双引擎 Legacy 代码，升级 AI SDK v4→v5/v6，全面迁移到 Mastra 框架六层栈（Agent/Memory/Storage/Vector/Tools/Processors）。

**Architecture:** 用 Mastra Agent 类替代手写 streamText 包装，Mastra Memory + LibSQLVector 替代自定义记忆/向量系统，libsql 替代 better-sqlite3 作为数据库引擎，Drizzle 保留管理业务配置表。

**Tech Stack:** Mastra v1.42, @mastra/memory v1.20, @mastra/libsql v1.13, @ai-sdk/openai v3, @ai-sdk/anthropic v1.2, drizzle-orm v0.45 (libsql), @libsql/client v0.14, Hono 4

---

### Task 1: 安装新依赖，移除旧依赖

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: 更新 package.json 依赖**

将 `packages/server/package.json` 的 dependencies 改为：

```json
"dependencies": {
  "@ai-sdk/anthropic": "^1.2.0",
  "@ai-sdk/openai": "^3.0.0",
  "@hono/node-server": "^2.0.4",
  "@libsql/client": "^0.14.0",
  "@mastra/ai-sdk": "^1.4.5",
  "@mastra/core": "^1.42.0",
  "@mastra/libsql": "^1.13.0",
  "@mastra/memory": "^1.20.3",
  "better-auth": "^1.6.16",
  "drizzle-orm": "^0.45.2",
  "hono": "^4.12.25",
  "pdf-parse": "^1.1.1",
  "uuid": "^10.0.0",
  "yaml": "^2.6.0",
  "zod": "^3.25.76"
}
```

移除的包：`ai`, `@ai-sdk/react`, `better-sqlite3`

- [ ] **Step 2: 安装依赖**

```bash
cd vico/server && pnpm install
```

Expected: 安装成功，无 peer dependency 冲突（Mastra 系列版本互相兼容）。

- [ ] **Step 3: 验证关键包可导入**

```bash
cd vico/server && node -e "require('@mastra/core'); require('@mastra/memory'); require('@mastra/libsql'); require('@libsql/client'); require('drizzle-orm/libsql'); console.log('OK')"
```

Expected: `OK` （注意：包是 ESM，需要用 `tsx` 运行而不是 node）

```bash
cd vico/server && pnpm tsx -e "import '@mastra/core'; import '@mastra/memory'; import '@mastra/libsql'; import '@libsql/client'; import 'drizzle-orm/libsql'; console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add vico/server/package.json vico/server/pnpm-lock.yaml
git commit -m "chore: upgrade deps — remove ai v4/better-sqlite3, add Mastra stack + libsql"
```

---

### Task 2: 创建 libsql 数据库初始化 + Drizzle 适配

**Files:**
- Create: `packages/server/src/db/init-libsql.ts`
- Modify: `packages/server/src/db/db.ts`（改为调用 init-libsql）
- Modify: `packages/server/src/db/schema.ts`（删除 Mastra 接管的表）
- Modify: `packages/server/src/config.ts`（移除 database.path，改为 database.url）

- [ ] **Step 1: 创建 `db/init-libsql.ts`**

```typescript
/**
 * libsql 客户端 + Drizzle ORM 初始化
 * 替代原来的 better-sqlite3 getDb()/getSqlite()
 * Mastra 的 LibSQLStore/LibSQLVector 通过 url 独立连接同一文件
 */
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { config } from '../config.js';
import * as bizSchema from './schema.js';
import * as authSchema from './auth-schema.js';

const combinedSchema = { ...bizSchema, ...authSchema };

let _client: Client;
let _db: LibSQLDatabase<typeof combinedSchema>;

export function getClient(): Client {
  if (!_client) {
    _client = createClient({ url: config.database.url });
  }
  return _client;
}

export function getDb(): LibSQLDatabase<typeof combinedSchema> {
  if (!_db) {
    _db = drizzle(getClient(), { schema: combinedSchema });
  }
  return _db;
}

export function getDatabaseUrl(): string {
  return config.database.url;
}

export { combinedSchema as schema };
```

- [ ] **Step 2: 更新 `db/db.ts` — 重定向到 init-libsql**

```typescript
// Re-export from new libsql init
// Legacy better-sqlite3 exports removed — use getDb() and getClient() instead
export { getDb, getClient, getDatabaseUrl, schema } from './init-libsql.js';
```

- [ ] **Step 3: 精简 `db/schema.ts` — 删除 Mastra 接管的表**

从 schema.ts 中删除以下表定义（Mastra Memory/Vector 接管）：
- `memory_entries`（被 Mastra Memory 的 semanticRecall + workingMemory 接管）
- `chunks`（被 LibSQLVector 接管）
- `tool_call_logs`（被 Processor 审计日志接管）
- `token_usage_logs`（被 Processor Token 跟踪接管）
- `conversations`（被 Mastra thread 接管）
- `messages`（被 Mastra message 接管）

保留的表：`model_configs`, `agents`, `installed_skills`, `agent_skills`, `knowledge_bases`, `agent_knowledge_bases`, `agentTeams`, `agentTeamMembers`

- [ ] **Step 4: 更新 `config.ts` — 添加 database.url 配置**

在配置类型定义中添加：

```typescript
database: {
  url: string;  // 'file:./data/vico.db'
}
```

更新 `server.config.yaml`：

```yaml
database:
  url: "file:./data/vico.db"
```

- [ ] **Step 5: Commit**

```bash
git add vico/server/src/db/init-libsql.ts vico/server/src/db/db.ts vico/server/src/db/schema.ts vico/server/src/config.ts vico/server/server.config.yaml
git commit -m "feat: replace better-sqlite3 with libsql + drizzle-orm/libsql"
```

---

### Task 3: 创建 Mastra Memory + Vector 初始化

**Files:**
- Create: `packages/server/src/agent/memory-setup.ts`

- [ ] **Step 1: 创建 `agent/memory-setup.ts`**

```typescript
/**
 * Mastra Memory + Vector 初始化
 * 创建共享的 LibSQLVector 和 Mastra Memory 实例
 * 用于所有 Agent 的对话持久化、语义召回、工作记忆
 */
import { Memory } from '@mastra/memory';
import { LibSQLVector } from '@mastra/libsql';
import { config } from '../config.js';

let _vector: LibSQLVector;
let _memory: Memory;

/** 获取或创建共享的 LibSQLVector 实例 */
export function getVector(): LibSQLVector {
  if (!_vector) {
    _vector = new LibSQLVector({
      url: config.database.url,
      id: 'vico-vector',
    });
  }
  return _vector;
}

/** 获取或创建共享的 Mastra Memory 实例 */
export function getMemory(): Memory {
  if (!_memory) {
    const vector = getVector();

    _memory = new Memory({
      id: 'vico-memory',
      name: 'Vico Agent Memory',
      vector,
      embedder: config.rag.embedder === 'local'
        ? 'openai/text-embedding-3-small' // Mastra 不支持本地 Transformers.js，降级为 OpenAI
        : 'openai/text-embedding-3-small',
      options: {
        lastMessages: config.memory.stm_window * 2, // 最近 N 条消息注入上下文
        semanticRecall: {
          topK: config.rag.retrieval_top_k,
          messageRange: { before: 50, after: 10 },
        },
      },
    });
  }
  return _memory;
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/memory-setup.ts
git commit -m "feat: add Mastra Memory + LibSQLVector initialization"
```

---

### Task 4: 创建 Skill 工具适配器（Vico SkillTool → Mastra createTool）

**Files:**
- Create: `packages/server/src/agent/tools/skill-tool-adapter.ts`

- [ ] **Step 1: 创建 skill-tool-adapter.ts**

```typescript
/**
 * Vico SkillTool → Mastra Tool 适配器
 * 将 Vico Skill 的 JSON Schema 参数定义转换为 Mastra createTool() 格式
 * 保留与现有 Skill 插件系统的完全兼容
 */
import { createTool } from '@mastra/core/tools';
import { z, type ZodTypeAny } from 'zod';
import { skillManager } from '../../skill/manager.js';
import type { SkillToolDef, ToolContext } from '../../skill/types.js';

/** 将 JSON Schema 参数转换为 Zod schema */
function jsonSchemaToZod(schema: Record<string, unknown>): ZodTypeAny {
  const type = schema.type as string;
  switch (type) {
    case 'string': {
      let s = z.string();
      if (schema.description) s = s.describe(schema.description as string);
      return s;
    }
    case 'number':
    case 'integer': {
      let n = z.number();
      if (schema.description) n = n.describe(schema.description as string);
      return n;
    }
    case 'boolean': {
      let b = z.boolean();
      if (schema.description) b = b.describe(schema.description as string);
      return b;
    }
    case 'array': {
      const items = schema.items
        ? jsonSchemaToZod(schema.items as Record<string, unknown>)
        : z.any();
      return z.array(items);
    }
    case 'object': {
      if (!schema.properties) return z.record(z.any());
      const shape: Record<string, ZodTypeAny> = {};
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const required = (schema.required as string[]) || [];
      for (const [key, propSchema] of Object.entries(props)) {
        let field = jsonSchemaToZod(propSchema);
        if (!required.includes(key)) field = field.optional();
        shape[key] = field;
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

/** 将单个 SkillToolDef 转换为 Mastra Tool */
function adaptTool(def: SkillToolDef, context: ToolContext) {
  const zodSchema = jsonSchemaToZod(def.parameters as Record<string, unknown>);

  return createTool({
    id: def.name,
    description: def.description,
    inputSchema: zodSchema as z.ZodObject<any>,
    execute: async ({ context: mastraCtx }) => {
      const args = (mastraCtx as any)?.args || {};
      // 查找并执行实际的 handler
      const tools = skillManager.getToolsForAgent(context.agentId);
      const tool = tools.find((t) => t.definition.name === def.name);
      if (!tool) throw new Error(`Tool ${def.name} handler not found`);
      return tool.handler(args, context);
    },
  });
}

/**
 * 获取 Agent 绑定的所有 Skill 工具，转换为 Mastra Tool 格式
 * 返回适合直接传入 Mastra Agent 的 tools 配置
 */
export function getSkillToolsForMastraAgent(
  agentId: string,
  context: ToolContext,
): Record<string, ReturnType<typeof createTool>> {
  const defs = skillManager.getToolDefsForAgent(agentId);
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const def of defs) {
    tools[def.name] = adaptTool(def, context);
  }
  return tools;
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/tools/skill-tool-adapter.ts
git commit -m "feat: add SkillTool → Mastra createTool adapter"
```

---

### Task 5: 创建 RAG 工具（LibSQLVector 搜索）

**Files:**
- Create: `packages/server/src/agent/tools/rag-tool.ts`

- [ ] **Step 1: 创建 rag-tool.ts**

```typescript
/**
 * RAG 知识库检索工具
 * 包装为 Mastra Tool，使用 LibSQLVector 进行语义搜索
 * 当 Agent 需要查询知识库时自动调用
 *
 * 注意：LibSQLVector.query() 需要预计算的向量，不能传文本。
 * 这里使用 Mastra Memory 的 embedder 来嵌入查询文本。
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/db.js';
import { getVector, getMemory } from '../memory-setup.js';
import { config } from '../../config.js';

const { agent_knowledge_bases } = schema;

/**
 * 创建知识库检索工具
 * @param agentId - Agent ID，用于查询该 Agent 绑定的知识库
 * @returns Mastra Tool 实例，或 null（Agent 无知识库绑定）
 */
export function createRagSearchTool(agentId: string) {
  const db = getDb();
  const kbBindings = db
    .select({ kb_id: agent_knowledge_bases.kb_id })
    .from(agent_knowledge_bases)
    .where(eq(agent_knowledge_bases.agent_id, agentId))
    .all();

  if (kbBindings.length === 0) return null;

  const kbIds = kbBindings.map((b) => b.kb_id);

  return createTool({
    id: 'search_knowledge_base',
    description: '搜索知识库获取相关文档内容。当需要查找特定信息、参考文档或获取领域知识时使用。',
    inputSchema: z.object({
      query: z.string().describe('在知识库中搜索的查询字符串'),
    }),
    execute: async ({ context }) => {
      const query = ((context as any)?.args?.query as string) || '';
      if (!query.trim()) return '未提供搜索查询';

      const memory = getMemory();
      if (!memory.embedder) return '嵌入模型未配置';

      const vector = getVector();
      try {
        // MastraEmbeddingModel.doEmbed({ values: string[] }) → { embeddings: number[][] }
        const result = await memory.embedder.doEmbed({ values: [query] });
        const queryEmbedding = result.embeddings[0];

        const results: string[] = [];
        for (const kbId of kbIds) {
          const indexName = `kb_${kbId}`;
          try {
            const searchResults = await vector.query({
              indexName,
              queryVector: queryEmbedding,
              topK: config.rag.retrieval_top_k,
            });
            for (const r of searchResults) {
              if (r.metadata?.content) {
                results.push(r.metadata.content as string);
              }
            }
          } catch {
            continue;
          }
        }

        if (results.length === 0) return '未找到相关知识库内容';
        return results.join('\n\n---\n\n');
      } catch (err: any) {
        return `知识库搜索失败: ${err.message}`;
      }
    },
  });
}
```

- [ ] **Step 2: 更新 rag.ts — 文档索引改用 LibSQLVector**

`memory/rag.ts` 的文件解析和分块逻辑保留，但向量存储部分改为写入 LibSQLVector：

删除对以下模块的依赖：
- `./embedder.js`（getEmbedder, float32ToBlob, blobToFloat32, cosineSimilarity）
- `schema` 中的 `chunks` 表

新增使用 LibSQLVector 存储 chunk：

```typescript
import { getVector, getMemory } from '../agent/memory-setup.js';

// 在 indexFile() 中：
const vector = getVector();
const memory = getMemory();
const chunks = splitText(text, config.rag.chunk_size, config.rag.chunk_overlap);

// 使用 Mastra embedder 批量嵌入所有 chunks
const embedResult = await memory.embedder!.doEmbed({
  values: chunks.map(c => c.content),
});

// 批量写入 LibSQLVector
await vector.upsert({
  indexName: `kb_${kbId}`,
  vectors: embedResult.embeddings,
  ids: chunkIds,
  metadata: chunks.map(c => ({ content: c.content, ...c.metadata })),
});
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/tools/rag-tool.ts vico/server/src/memory/rag.ts
git commit -m "feat: add RAG search tool using LibSQLVector + embed query"
```

---

### Task 6: 创建 Mastra Processor（审计日志 + Token 统计）

**Files:**
- Create: `packages/server/src/agent/processors/audit-logger.ts`
- Create: `packages/server/src/agent/processors/token-tracker.ts`

- [ ] **Step 1: 创建 audit-logger.ts**

```typescript
/**
 * Mastra Output Processor — 工具调用审计日志
 * 每次工具调用完成时记录到日志（当前阶段用 console 结构化日志）
 * 后续可接入 Mastra Observability 域做持久化
 */
import type { Processor } from '@mastra/core/processors';

interface AuditLoggerConfig {
  tenantId: string;
  agentId: string;
  conversationId?: string;
}

export function createAuditLogger(config: AuditLoggerConfig): Processor<'audit-logger'> {
  return {
    id: 'audit-logger',
    name: 'Tool Audit Logger',
    description: 'Records tool call results for audit trail',

    async processOutputResult(args) {
      const toolCalls = args.output?.toolCalls;
      if (!toolCalls || toolCalls.length === 0) return {};

      for (const tc of toolCalls) {
        console.log(JSON.stringify({
          component: 'audit',
          tenantId: config.tenantId,
          agentId: config.agentId,
          conversationId: config.conversationId,
          toolName: tc.toolName,
          status: 'completed',
          timestamp: Date.now(),
        }));
      }
      return {};
    },
  };
}
```

- [ ] **Step 2: 创建 token-tracker.ts**

```typescript
/**
 * Mastra Output Processor — Token 用量跟踪
 * 每次 LLM 响应完成时记录 Token 消耗
 * 后续可接入 Mastra Observability 域做持久化
 */
import type { Processor } from '@mastra/core/processors';

interface TokenTrackerConfig {
  tenantId: string;
  agentId: string;
  modelName: string;
}

export function createTokenTracker(config: TokenTrackerConfig): Processor<'token-tracker'> {
  return {
    id: 'token-tracker',
    name: 'Token Usage Tracker',
    description: 'Tracks LLM token consumption per request',

    async processOutputResult(args) {
      const usage = args.output?.usage;
      if (!usage) return {};

      console.log(JSON.stringify({
        component: 'token',
        tenantId: config.tenantId,
        agentId: config.agentId,
        modelName: config.modelName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        timestamp: Date.now(),
      }));

      return {};
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/processors/audit-logger.ts vico/server/src/agent/processors/token-tracker.ts
git commit -m "feat: add Mastra processors for audit logging and token tracking"
```

---

### Task 7: 创建 SSE 工具函数

**Files:**
- Create: `packages/server/src/agent/sse-utils.ts`

- [ ] **Step 1: 创建 sse-utils.ts**

```typescript
/**
 * 统一的 SSE ReadableStream 工厂
 * 从 MastraModelOutput.textStream 创建符合 Vico 前端格式的 SSE 流
 *
 * 事件格式:
 * - text_delta: { type: 'text_delta', content: string }
 * - tool_call:   { type: 'tool_call', toolName: string, args: unknown }
 * - tool_result: { type: 'tool_result', toolName: string, result: string }
 * - done:        { type: 'done', usage: { promptTokens, completionTokens } }
 * - error:       { type: 'error', message: string }
 */
import type { MastraModelOutput } from '@mastra/core/stream';

export function createSSEStream(output: MastraModelOutput<any>): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 流式文本增量
        for await (const chunk of output.textStream) {
          enqueue({ type: 'text_delta', content: chunk });
        }

        // 工具调用和结果（异步获取，流已结束）
        const [toolCalls, toolResults, usage] = await Promise.all([
          output.toolCalls.catch(() => []),
          output.toolResults.catch(() => []),
          output.usage.catch(() => undefined),
        ]);

        for (const tc of toolCalls) {
          enqueue({ type: 'tool_call', toolName: tc.toolName, args: tc.args });
        }
        for (const tr of toolResults) {
          enqueue({ type: 'tool_result', toolName: tr.toolName, result: tr.result });
        }

        enqueue({
          type: 'done',
          usage: usage || {},
        });
      } catch (err: any) {
        enqueue({ type: 'error', message: err.message || 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/sse-utils.ts
git commit -m "feat: add unified SSE stream factory for Mastra output"
```

---

### Task 8: 创建 Agent 工厂

**Files:**
- Create: `packages/server/src/agent/agent-factory.ts`

- [ ] **Step 1: 创建 agent-factory.ts**

```typescript
/**
 * Vico Agent 工厂 — 将 Vico Agent 配置转换为 Mastra Agent 实例
 *
 * 每个请求动态构造 Mastra Agent，注入:
 * - instructions: Agent system_prompt + Skill prompts + RAG 上下文
 * - model: 根据 model_configs 表解析的 AI SDK model 实例
 * - tools: Skill 工具（通过 skill-tool-adapter）+ RAG 工具
 * - memory: 共享的 Mastra Memory 实例（自动处理 STM/LTM/Working/Observational）
 * - processors: 审计日志 + Token 跟踪
 * - defaultOptions: maxSteps、temperature 等
 */
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/db.js';
import { getDefaultModel, type ModelConfigRow } from './model-registry.js';
import { skillManager } from '../skill/manager.js';
import { getMemory } from './memory-setup.js';
import { getSkillToolsForMastraAgent } from './tools/skill-tool-adapter.js';
import { createRagSearchTool } from './tools/rag-tool.js';
import { createAuditLogger } from './processors/audit-logger.js';
import { createTokenTracker } from './processors/token-tracker.js';

const { agents, agent_knowledge_bases } = schema;

/** 根据 Vico model_configs 行创建 AI SDK LanguageModel */
function resolveModelProvider(modelConfig: ModelConfigRow) {
  const apiKey = modelConfig.api_key_encrypted;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelConfig.model_name);
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name);
  }
}

export interface AgentContext {
  tenantId: string;
  agentId: string;
  userId: string;
}

/**
 * 根据 Vico Agent 配置创建 Mastra Agent 实例
 *
 * @param ctx - Agent 上下文（租户、Agent ID、用户）
 * @returns 配置好的 Mastra Agent 实例
 */
export async function createAgent(ctx: AgentContext): Promise<Agent> {
  const db = getDb();

  // 1. 加载 Vico Agent 配置
  const agentRow = db.select().from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agentRow) throw new Error('Agent not found');

  // 2. 解析模型
  const modelConfig = getDefaultModel(ctx.tenantId);
  if (!modelConfig) throw new Error('No LLM model configured');
  const model = resolveModelProvider(modelConfig);

  // 3. 构建 instructions（system prompt + skill prompts）
  const skillPrompts = skillManager.getPromptForAgent(ctx.agentId);
  let instructions = agentRow.system_prompt || '';
  if (skillPrompts) {
    instructions += '\n\n## 技能指南\n' + skillPrompts;
  }
  // RAG 上下文由 RAG tool 运行时注入，instructions 中不需要预加载

  // 4. 构建 tools
  const skillTools = getSkillToolsForMastraAgent(ctx.agentId, {
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    userId: ctx.userId,
    skillConfig: {},
  });

  const tools: Record<string, any> = { ...skillTools };

  const ragTool = createRagSearchTool(ctx.agentId);
  if (ragTool) {
    tools[ragTool.id] = ragTool;
  }

  // 5. 获取共享 Memory
  const memory = getMemory();

  // 6. 构建 Processors
  const inputProcessors: any[] = [];
  const outputProcessors: any[] = [
    createAuditLogger({
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
    }),
    createTokenTracker({
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      modelName: modelConfig.model_name,
    }),
  ];

  // 7. 创建 Mastra Agent
  const agent = new Agent({
    id: `vico-agent-${ctx.agentId}`,
    name: agentRow.name,
    instructions,
    model,
    tools,
    memory,
    inputProcessors,
    outputProcessors,
    defaultOptions: {
      maxSteps: 10,
    },
  });

  return agent;
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/agent-factory.ts
git commit -m "feat: add Agent factory — Vico config → Mastra Agent"
```

---

### Task 9: 更新 API 路由（chat.ts 调用 Mastra Agent）

**Files:**
- Modify: `packages/server/src/api/chat.ts`

- [ ] **Step 1: 重写 chat.ts — 单 Agent 对话路由**

```typescript
import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { createAgent } from '../agent/agent-factory.js';
import { createSSEStream } from '../agent/sse-utils.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 */
  app.post('/api/v1/chat', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    const { agentId, message } = body;
    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    // 创建 Mastra Agent
    const agent = await createAgent({
      tenantId: auth.tenantId,
      agentId,
      userId: auth.userId,
    });

    // 执行流式对话 — Mastra Agent 自动处理 memory/thread
    const output = await agent.stream([{ role: 'user', content: message }], {
      memory: {
        thread: `${agentId}-${auth.userId}`,
        resource: auth.tenantId,
      },
    });

    // 包装为 SSE 流
    const stream = createSSEStream(output);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  /** 团队对话 — 保持当前实现，后续用 Mastra network() 替代 */
  app.post('/api/v1/teams/:id/chat', async (c) => {
    // 暂时保留 orchestrator 调用，后续迁移为 Mastra agent.network()
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const teamId = c.req.param('id');
    const body = await c.req.json();
    const { message, conversationId } = body;
    if (!message) return c.json({ error: 'message is required' }, 400);

    // 临时保留 orchestrator 导入（后续 Task 替换为 Mastra network）
    const { runTeamPipeline } = await import('../agent/orchestrator.js');
    const result = await runTeamPipeline(teamId, message, {
      tenantId: auth.tenantId,
      agentId: teamId,
      userId: auth.userId,
      conversationId: conversationId || undefined,
    });

    return new Response(result.stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': result.metadata.conversationId,
      },
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/api/chat.ts
git commit -m "feat: update chat API to use Mastra Agent.stream()"
```

---

### Task 10: 删除旧文件

**Files to DELETE (16 files):**

```
packages/server/src/agent/pipeline.ts
packages/server/src/agent/mastra/agent-factory.ts
packages/server/src/agent/mastra/bridges/model-bridge.ts
packages/server/src/agent/mastra/bridges/skill-bridge.ts
packages/server/src/agent/mastra/bridges/rag-bridge.ts
packages/server/src/agent/mastra/bridges/auth-bridge.ts
packages/server/src/agent/mastra/processors/audit-logger.ts
packages/server/src/agent/mastra/processors/token-tracker.ts
packages/server/src/agent/mastra/processors/message-persister.ts
packages/server/src/agent/mastra/storage.ts
packages/server/src/agent/mastra/index.ts
packages/server/src/agent/tool-executor.ts
packages/server/src/memory/long-term.ts
packages/server/src/memory/working-memory.ts
packages/server/src/memory/observational-memory.ts
packages/server/src/memory/embedder.ts
```

- [ ] **Step 1: 删除所有旧文件**

```bash
rm vico/server/src/agent/pipeline.ts
rm vico/server/src/agent/mastra/agent-factory.ts
rm vico/server/src/agent/mastra/bridges/model-bridge.ts
rm vico/server/src/agent/mastra/bridges/skill-bridge.ts
rm vico/server/src/agent/mastra/bridges/rag-bridge.ts
rm vico/server/src/agent/mastra/bridges/auth-bridge.ts
rm vico/server/src/agent/mastra/processors/audit-logger.ts
rm vico/server/src/agent/mastra/processors/token-tracker.ts
rm vico/server/src/agent/mastra/processors/message-persister.ts
rm vico/server/src/agent/mastra/storage.ts
rm vico/server/src/agent/mastra/index.ts
rm vico/server/src/agent/tool-executor.ts
rm vico/server/src/memory/long-term.ts
rm vico/server/src/memory/working-memory.ts
rm vico/server/src/memory/observational-memory.ts
rm vico/server/src/memory/embedder.ts
```

- [ ] **Step 2: 清理空目录**

```bash
rmdir vico/server/src/agent/mastra/bridges 2>/dev/null || true
rmdir vico/server/src/agent/mastra/processors 2>/dev/null || true
rmdir vico/server/src/agent/mastra 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add -A vico/server/src/
git commit -m "refactor: remove legacy pipeline, tool executor, custom memory/embedder — replaced by Mastra stack"
```

---

### Task 11: 更新其他引用旧模块的文件

**Files:**
- Modify: `packages/server/src/memory/rag.ts`（移除对 embedder 和 memory_entries 的依赖）
- Check: 全局搜索所有 import 旧模块的地方并修复

- [ ] **Step 1: 搜索所有引用旧模块的 import 语句**

```bash
cd vico/server && grep -r "from.*memory/long-term" src/ || true
cd vico/server && grep -r "from.*memory/embedder" src/ || true
cd vico/server && grep -r "from.*agent/pipeline" src/ || true
cd vico/server && grep -r "from.*agent/tool-executor" src/ || true
cd vico/server && grep -r "from.*agent/mastra" src/ || true
cd vico/server && grep -r "from.*memory/working-memory" src/ || true
cd vico/server && grep -r "from.*memory/observational-memory" src/ || true
```

Expected: 只有 `chat.ts`（已更新）和可能的 `rag.ts`。如果 orchestrator.ts 存在引用，需要处理。

- [ ] **Step 2: 更新 rag.ts — 保留分块/解析，替换数据库写入**

rag.ts 的文件解析和分块逻辑保留，但存储部分改用 LibSQLVector：

```typescript
// rag.ts 中移除:
// import { getEmbedder, float32ToBlob, ... } from './embedder.js'
// 不再直接写 chunks 表

// 新增: 使用 LibSQLVector 存储 chunk 向量
import { getVector } from '../agent/memory-setup.js';

// indexFile() 中，将 chunk 向量写入 LibSQLVector:
// const vector = getVector();
// await vector.upsert({ indexName: `kb_${kbId}`, vectors: [...], metadata: [...] });
```

- [ ] **Step 3: 更新 orchestrator.ts 引用**

如果 orchestrator.ts 仍然引用旧的 `long-term.ts`、`working-memory.ts` 等，需要改为引用 Mastra 模块或临时保留。orchestrator 后续会被 Mastra `agent.network()` 替代，此阶段先确保编译通过。

- [ ] **Step 4: Commit**

```bash
git add -A vico/server/src/
git commit -m "fix: update remaining references to removed modules"
```

---

### Task 12: 更新短期记忆模块

**Files:**
- Modify: `packages/server/src/memory/short-term.ts`

- [ ] **Step 1: 移除 short-term.ts — Mastra Memory lastMessages 接管**

短期记忆由 Mastra Memory 的 `lastMessages` 选项自动处理，不需要独立模块。

删除 `short-term.ts` 文件（如果还有其他地方引用，改为直接从 Mastra Memory 获取）。

如果 chat.ts 或 agent-factory.ts 已不再引用 short-term.ts，直接删除。

- [ ] **Step 2: Commit**

```bash
git add -A vico/server/src/memory/
git commit -m "refactor: remove short-term memory — Mastra Memory handles it"
```

---

### Task 13: 尝试编译，修复类型错误

- [ ] **Step 1: 运行 TypeScript 编译检查**

```bash
cd vico/server && pnpm build 2>&1 | head -100
```

- [ ] **Step 2: 逐条修复编译错误**

检查每个编译错误，修复类型不匹配、缺失导入、API 签名变更等问题。

- [ ] **Step 3: 循环直到编译通过**

```bash
cd vico/server && pnpm build
```

Expected: 编译成功退出。

- [ ] **Step 4: Commit**

```bash
git add -A vico/server/src/
git commit -m "fix: resolve TypeScript compilation errors after Mastra migration"
```

---

### Task 14: 验证启动和基础功能

- [ ] **Step 1: 启动服务端**

```bash
cd vico/server && pnpm dev
```

Expected: `[Vico] Server running on http://localhost:3001`

- [ ] **Step 2: 测试健康检查**

```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: 测试模型列表 API**

```bash
# 先登录获取 cookie
curl -X POST http://localhost:3001/api/auth/sign-in/username \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' -c /tmp/cookie

# 查询模型
curl http://localhost:3001/api/v1/models -b /tmp/cookie
```

Expected: 返回已配置的模型列表。

- [ ] **Step 4: 测试 Agent 列表**

```bash
curl http://localhost:3001/api/v1/agents -b /tmp/cookie
```

Expected: 返回 Agent 列表。

- [ ] **Step 5: 测试 Chat SSE（需要 Model 已配置）**

```bash
# 先通过 UI 或 API 确保有默认模型和 Agent
curl -N -X POST http://localhost:3001/api/v1/chat \
  -H 'Content-Type: application/json' \
  -b /tmp/cookie \
  -d '{"agentId":"<agent-id>","message":"你好"}'
```

Expected: 返回 SSE 流，包含 `text_delta` 和 `done` 事件。

- [ ] **Step 6: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: startup and API verification fixes"
```

---

### Task 15: 更新前端 SSE 解析（如格式变化）

**Files:**
- 可能需要修改: `packages/web/src/api/client.ts`

- [ ] **Step 1: 对比新旧 SSE 格式**

旧格式:
```
data: {"type":"text_delta","content":"..."}
data: {"type":"done","usage":{}}
```

新格式（与旧格式保持兼容，增加 tool_call/tool_result 事件）:
```
data: {"type":"text_delta","content":"..."}
data: {"type":"tool_call","toolName":"...","args":{...}}
data: {"type":"tool_result","toolName":"...","result":"..."}
data: {"type":"done","usage":{"promptTokens":...,"completionTokens":...}}
```

基本格式相同，前端 SSE 解析无需改动。如果前端需要展示工具调用，可以新增 tool_call/tool_result 事件处理。

- [ ] **Step 2: 如需要，更新前端 SSE 解析**

在 `packages/web/src/api/client.ts` 的 `streamChat` 函数中新增 `tool_call` 和 `tool_result` 事件类型处理（当前默认 ignore 未知事件）。

- [ ] **Step 3: Commit（如有修改）**

```bash
git add -A vico/web/
git commit -m "feat: add tool_call/tool_result SSE event support to frontend"
```

---

### Task 16: 移除 config.ts 中的 agent_engine 和旧配置

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/server.config.yaml`

- [ ] **Step 1: 移除 agent_engine 配置**

在 `config.ts` 类型定义中删除 `server.agent_engine` 字段。
在 `server.config.yaml` 中删除 `agent_engine: legacy` 行。

- [ ] **Step 2: 移除 stm_window 配置（由 Mastra Memory 管理）**

`memory.stm_window` 现在由 Mastra Memory 的 `lastMessages` 选项管理，可保留配置但标记为 Mastra 使用。

```yaml
memory:
  stm_window: 20  # Mastra Memory lastMessages 使用
  ltm_auto_extract: true  # Mastra Memory 自动处理，保留配置
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/config.ts vico/server/server.config.yaml
git commit -m "chore: remove agent_engine toggle, clean up deprecated config"
```

---

### Task 17: 最终集成测试

- [ ] **Step 1: 完整启动测试**

```bash
pnpm dev
```

Expected: 前后端正常启动，前端能登录和操作。

- [ ] **Step 2: 测试聊天完整流程**

1. 登录
2. 确保有默认模型
3. 创建 Agent（如无）
4. 发送消息
5. 验证 SSE 流式响应
6. 验证对话历史在 Mastra Memory 中持久化

- [ ] **Step 3: 测试多轮对话**

发送第二条消息，验证 Mastra Memory 正确注入历史上下文。

- [ ] **Step 4: 测试 Skill 工具调用**

为 Agent 绑定一个 Skill，发送触发工具调用的消息，验证工具执行和结果。

- [ ] **Step 5: 测试 RAG 知识库**

上传文档到知识库，发送相关问题，验证 RAG 检索。

- [ ] **Step 6: Commit 修复**

```bash
git add -A
git commit -m "test: integration test fixes for Mastra migration"
```
