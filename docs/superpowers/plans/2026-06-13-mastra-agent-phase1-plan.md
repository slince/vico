# Mastra Agent 引擎 Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 Mastra 替换 Vico 现有 `pipeline.ts`，Agent 获得自主推理循环（理解意图 → 工具调用 → 结果评估 → 修正重试），同时保持 API 和前端完全兼容。

**Architecture:** Mastra 嵌入现有 Hono App，通过 4 个 Bridge 模块（Model / Skill / RAG / Auth）连接 Vico 现有系统。Chat API 内部委托给 Mastra Agent，对外 SSE 格式不变。保留 `pipeline.ts` 作为 feature flag 回退路径。

**Tech Stack:** Mastra (`@mastra/core`, `@mastra/libsql`), Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`), Hono, better-sqlite3, Drizzle ORM, Zod

---

## 文件结构

```
packages/server/src/agent/
├── mastra/
│   ├── index.ts                     # 新增: getMastra() 单例，Mastra 实例生命周期
│   ├── agent-factory.ts             # 新增: Vico Agent DB 配置 → Mastra Agent
│   ├── bridges/
│   │   ├── model-bridge.ts          # 新增: Bridge 1 - ModelConfig → AI SDK model
│   │   ├── skill-bridge.ts          # 新增: Bridge 2 - SkillTool → Mastra tools
│   │   ├── rag-bridge.ts            # 新增: Bridge 3 - RAG 作为 tool 暴露
│   │   └── auth-bridge.ts           # 新增: Bridge 4 - AuthContext → threadId/resourceId
│   ├── processors/
│   │   ├── audit-logger.ts          # 新增: 工具调用审计 → tool_call_logs
│   │   ├── token-tracker.ts         # 新增: Token 统计 → token_usage_logs
│   │   └── message-persister.ts     # 新增: 消息持久化 → messages 表
│   └── storage.ts                   # 新增: Mastra LibSQL Storage 配置
├── pipeline.ts                      # 修改: 添加 feature flag，委托给 Mastra
├── tool-executor.ts                 # 不变
└── model-registry.ts                # 不变

packages/server/src/api/
├── chat.ts                          # 修改: 内部调用 Mastra Agent

packages/server/
├── package.json                     # 修改: 添加 Mastra 依赖
├── server.config.yaml               # 修改: 添加 agent_engine feature flag
└── src/config.ts                    # 修改: 添加 agent_engine 配置项
```

---

### Task 1: 安装 Mastra 依赖

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: 添加 Mastra 核心依赖**

```bash
cd vico/server && pnpm add @mastra/core @mastra/libsql
```

Expected: 安装成功，`package.json` 中新增 `@mastra/core` 和 `@mastra/libsql` 依赖项。

- [ ] **Step 2: 验证安装**

```bash
cd vico/server && node -e "import('@mastra/core').then(m => console.log('Mastra core OK:', Object.keys(m).slice(0,5)))"
```

Expected: 输出 `Mastra core OK: [...]`，确认模块可加载。

- [ ] **Step 3: Commit**

```bash
git add vico/server/package.json vico/server/pnpm-lock.yaml
git commit -m "chore: add @mastra/core and @mastra/libsql dependencies"
```

---

### Task 2: 配置 agent_engine Feature Flag

**Files:**
- Modify: `packages/server/server.config.yaml`
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: 在 config.ts 中添加 agent_engine 配置项**

编辑 `packages/server/src/config.ts`，在 `AppConfig` 接口中添加：

```typescript
// 在 AppConfig 接口的 server 块中添加 agent_engine 字段
interface AppConfig {
  server: {
    port: number;
    deploy_mode: 'private' | 'saas';
    agent_engine?: 'mastra' | 'legacy';  // 新增: Agent 引擎选择
  };
  // ... 其余不变
}
```

同时更新 `loadConfig()` 中 server 默认值：

```typescript
server: { port: 3001, deploy_mode: 'private', agent_engine: 'legacy' },
```

- [ ] **Step 2: 在 server.config.yaml 中添加配置**

编辑 `packages/server/server.config.yaml`，在 `server` 块中添加：

```yaml
server:
  port: 3001
  deploy_mode: private
  agent_engine: legacy  # 'mastra' 或 'legacy'，切换 Agent 引擎
```

- [ ] **Step 3: 验证配置加载**

```bash
cd vico/server && node -e "
const { config } = require('./src/config.ts' || await import('./src/config.ts'));
" 2>&1 || echo "(ESM, use tsx)"

cd vico/server && npx tsx -e "
import { config } from './src/config.js';
console.log('agent_engine:', config.server.agent_engine);
"
```

Expected: 输出 `agent_engine: legacy`。

- [ ] **Step 4: Commit**

```bash
git add vico/server/server.config.yaml vico/server/src/config.ts
git commit -m "feat: add agent_engine feature flag (mastra|legacy)"
```

---

### Task 3: 创建 Mastra LibSQL Storage

**Files:**
- Create: `packages/server/src/agent/mastra/storage.ts`

- [ ] **Step 1: 创建 Storage 配置模块**

```typescript
// vico/server/src/agent/mastra/storage.ts
// Mastra LibSQL 存储配置，使用独立 DB 文件避免与 Drizzle ORM 冲突

import { LibSQLStore } from '@mastra/libsql';
import { config } from '../../config.js';
import { dirname, join } from 'node:path';

/** Mastra 专用数据库路径，与 vico.db 同目录但独立文件 */
const mastraDbPath = join(dirname(config.database.path), 'vico_mastra.db');

let storage: LibSQLStore;

/** 获取 Mastra LibSQL Storage 单例 */
export function getMastraStorage(): LibSQLStore {
  if (!storage) {
    storage = new LibSQLStore({
      url: `file:${mastraDbPath}`,
    });
    console.log(`[Mastra] Storage initialized: ${mastraDbPath}`);
  }
  return storage;
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la vico/server/src/agent/mastra/storage.ts
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/mastra/storage.ts
git commit -m "feat: add Mastra LibSQL storage configuration"
```

---

### Task 4: 创建 Model Bridge

**Files:**
- Create: `packages/server/src/agent/mastra/bridges/model-bridge.ts`

- [ ] **Step 1: 创建 Model Bridge 模块**

```typescript
// vico/server/src/agent/mastra/bridges/model-bridge.ts
// Bridge 1: Vico ModelConfigRow → AI SDK LanguageModel (已包裹 withMastra)

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDefaultModel, getModelById, type ModelConfigRow } from '../../model-registry.js';
import { getMastraStorage } from '../storage.js';
import type { LanguageModelV2 } from 'ai';

/**
 * 根据 Vico model_configs 行创建对应的 AI SDK LanguageModel 实例。
 * 根据 provider 字段路由到 OpenAI / Anthropic / OpenAI 兼容接口。
 * 不在此处包裹 withMastra()，因为 withMastra 需要在 Agent 构建时根据
 * 每请求的 threadId/resourceId 动态配置 memory。
 */
export function resolveModelProvider(modelConfig: ModelConfigRow): LanguageModelV2 {
  const apiKey = modelConfig.api_key_encrypted;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelConfig.model_name) as unknown as LanguageModelV2;
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name) as unknown as LanguageModelV2;
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name) as unknown as LanguageModelV2;
  }
}

/**
 * 根据 Vico Agent 配置解析其使用的模型。
 * 若 agent 指定了 model_id，使用该模型；否则使用租户默认模型。
 * 注意：返回的 model 未包裹 withMastra，需在 Mastra Agent 创建时包裹。
 */
export function resolveAgentModel(tenantId: string, modelId?: string): {
  model: LanguageModelV2;
  modelConfig: ModelConfigRow;
} {
  let modelConfig: ModelConfigRow | null;

  if (modelId) {
    modelConfig = getModelById(tenantId, modelId);
  } else {
    modelConfig = getDefaultModel(tenantId);
  }

  if (!modelConfig) {
    throw new Error('No LLM model configured. Please add a model in Settings first.');
  }

  return {
    model: resolveModelProvider(modelConfig),
    modelConfig,
  };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd vico/server && npx tsc --noEmit src/agent/mastra/bridges/model-bridge.ts 2>&1 | head -20
```

Expected: 无类型错误（可能有模块解析警告，正常）。

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/mastra/bridges/model-bridge.ts
git commit -m "feat: add Model Bridge - Vico ModelConfig to AI SDK model"
```

---

### Task 5: 创建 Skill Bridge

**Files:**
- Create: `packages/server/src/agent/mastra/bridges/skill-bridge.ts`

- [ ] **Step 1: 创建 Skill Bridge 模块**

```typescript
// vico/server/src/agent/mastra/bridges/skill-bridge.ts
// Bridge 2: Vico SkillTool[] → Mastra-compatible tools (Record<string, Tool>)
// 将 JSON Schema parameters 转换为 Zod schema

import { z } from 'zod';
import { skillManager } from '../../skill/manager.js';
import type { SkillTool, SkillToolDef, ToolContext } from '../../skill/types.js';
import type { Tool, ToolAction } from '@mastra/core';

/**
 * 将 JSON Schema 简单类型映射到 Zod schema。
 * 支持 string / number / boolean / enum / array / object 基础类型。
 * 复杂嵌套类型降级为 z.any()，不影响工具调用。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<any> {
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
      const shape: Record<string, z.ZodType<any>> = {};
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const required = (schema.required as string[]) || [];
      for (const [key, propSchema] of Object.entries(props)) {
        let field = jsonSchemaToZod(propSchema);
        if (!required.includes(key)) {
          field = field.optional();
        }
        shape[key] = field;
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

/**
 * 将单个 SkillTool 适配为 Mastra Tool 格式。
 * JSON Schema parameters 转换为 Zod schema，handler 包装为 Mastra execute 函数。
 */
function skillToolToMastraTool(tool: SkillTool, ctx: ToolContext): Tool {
  const inputSchema = jsonSchemaToZod(tool.definition.parameters as Record<string, unknown>);

  const execute: ToolAction<any, any> = async ({ context: callContext }) => {
    // Mastra 通过 callContext 传入的参数在 args 中
    const args = (callContext as any)?.args || callContext;
    return tool.handler(args, ctx);
  };

  return {
    id: tool.definition.name,
    description: tool.definition.description,
    inputSchema,
    execute,
  } as unknown as Tool;
}

/**
 * 获取 Agent 绑定的所有 Skill 工具，适配为 Mastra Tool 格式。
 * 返回 Mastra Agent 可直接使用的 tools 对象。
 */
export function getSkillToolsForMastraAgent(agentId: string, ctx: Omit<ToolContext, 'skillConfig'>): Record<string, Tool> {
  const skillTools = skillManager.getToolsForAgent(agentId);
  const tools: Record<string, Tool> = {};

  for (const st of skillTools) {
    const toolCtx: ToolContext = {
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      userId: ctx.userId,
      skillConfig: {},
    };
    tools[st.definition.name] = skillToolToMastraTool(st, toolCtx);
  }

  return tools;
}

/**
 * 获取 Agent 绑定的所有 Skill 的提示词，拼接为一段文本。
 * 与原 pipeline.ts 中的拼接逻辑一致。
 */
export function getSkillPromptForAgent(agentId: string): string {
  return skillManager.getPromptForAgent(agentId);
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd vico/server && npx tsc --noEmit src/agent/mastra/bridges/skill-bridge.ts 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/mastra/bridges/skill-bridge.ts
git commit -m "feat: add Skill Bridge - Vico SkillTool to Mastra tools"
```

---

### Task 6: 创建 RAG Bridge

**Files:**
- Create: `packages/server/src/agent/mastra/bridges/rag-bridge.ts`

- [ ] **Step 1: 创建 RAG Bridge 模块**

```typescript
// vico/server/src/agent/mastra/bridges/rag-bridge.ts
// Bridge 3: Vico RAG 作为 Mastra Tool 暴露
// Phase 1 策略：将 Vico 知识库检索封装为 search_knowledge_base tool

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../../../db/db.js';
import { ragManager } from '../../../memory/rag.js';
import { config } from '../../../config.js';
import type { Tool } from '@mastra/core';

const { agent_knowledge_bases } = schema;

/**
 * 创建 RAG 检索 Tool，Agent 可主动调用 search_knowledge_base。
 * 后续 Phase 3 会替换为 Mastra SemanticRecall 原生检索。
 */
export function createRagTool(agentId: string, tenantId: string): Tool | null {
  // 检查 Agent 是否绑定了知识库
  const db = getDb();
  const bindings = db.select({ kb_id: agent_knowledge_bases.kb_id })
    .from(agent_knowledge_bases)
    .where(eq(agent_knowledge_bases.agent_id, agentId))
    .all();

  if (bindings.length === 0) return null;

  const kbIds = bindings.map((b) => b.kb_id);

  return {
    id: 'search_knowledge_base',
    description: '搜索知识库获取相关信息。当需要查询特定领域的专业知识时使用此工具。',
    inputSchema: z.object({
      query: z.string().describe('要搜索的问题或关键词'),
    }),
    execute: async ({ context }) => {
      const query = (context as any)?.query || (context as any)?.args?.query || '';
      const chunks = await ragManager.hybridSearch(query, kbIds, config.rag.retrieval_top_k);
      if (chunks.length === 0) return { results: [], message: '未找到相关知识' };
      return {
        results: chunks.map((c) => ({ content: c.content })),
        message: `找到 ${chunks.length} 条相关知识`,
      };
    },
  } as unknown as Tool;
}

/**
 * 获取 Agent 绑定的 RAG 知识库上下文文本。
 * 直接注入 system prompt（保留原 pipeline.ts 行为）。
 */
export async function getRagContext(agentId: string, message: string): Promise<string> {
  const db = getDb();
  const bindings = db.select({ kb_id: agent_knowledge_bases.kb_id })
    .from(agent_knowledge_bases)
    .where(eq(agent_knowledge_bases.agent_id, agentId))
    .all();

  if (bindings.length === 0) return '';

  const kbIds = bindings.map((b) => b.kb_id);
  const chunks = await ragManager.hybridSearch(message, kbIds, config.rag.retrieval_top_k);

  if (chunks.length === 0) return '';
  return '\n\n## 相关知识库内容\n' + chunks.map((c) => c.content).join('\n\n');
}
```

- [ ] **Step 2: 验证创建**

```bash
ls -la vico/server/src/agent/mastra/bridges/rag-bridge.ts
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/mastra/bridges/rag-bridge.ts
git commit -m "feat: add RAG Bridge - Vico knowledge search as Mastra tool"
```

---

### Task 7: 创建 Auth Bridge

**Files:**
- Create: `packages/server/src/agent/mastra/bridges/auth-bridge.ts`

- [ ] **Step 1: 创建 Auth Bridge 模块**

```typescript
// vico/server/src/agent/mastra/bridges/auth-bridge.ts
// Bridge 4: Vico AuthContext → Mastra RuntimeContext (threadId/resourceId)
// resourceId = tenantId 确保多租户记忆隔离
// threadId = conversationId 确保对话连续性

import type { AuthContext } from '../../../api/helpers.js';

export interface MastraRuntimeContext {
  threadId: string;
  resourceId: string;
}

/**
 * 将 Vico AuthContext 映射为 Mastra RuntimeContext。
 * 若 conversationId 不存在（新对话），使用临时 UUID（Mastra 会自动创建 thread）。
 */
export function authToMastraContext(
  auth: AuthContext,
  conversationId?: string,
): MastraRuntimeContext {
  return {
    threadId: conversationId || '',  // 空字符串表示新 thread，Mastra 自动创建
    resourceId: auth.tenantId,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/bridges/auth-bridge.ts
git commit -m "feat: add Auth Bridge - AuthContext to Mastra RuntimeContext"
```

---

### Task 8: 创建 Processors（审计、Token、持久化）

**Files:**
- Create: `packages/server/src/agent/mastra/processors/audit-logger.ts`
- Create: `packages/server/src/agent/mastra/processors/token-tracker.ts`
- Create: `packages/server/src/agent/mastra/processors/message-persister.ts`

- [ ] **Step 1: 创建审计日志 Processor**

```typescript
// vico/server/src/agent/mastra/processors/audit-logger.ts
// Mastra output processor: 工具调用审计 → tool_call_logs 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';
import type { ToolContext } from '../../../skill/types.js';

const { tool_call_logs } = schema;

interface AuditLoggerOptions {
  tenantId: string;
  agentId: string;
  conversationId: string;
}

/**
 * 创建工具调用审计 output processor。
 * Mastra 每次工具调用完成后触发，记录到 tool_call_logs 表。
 */
export function createAuditLogger(opts: AuditLoggerOptions) {
  return {
    type: 'output' as const,
    name: 'audit-logger',
    async process(args: { result: any; toolCalls?: any[] }) {
      const toolCalls = args?.toolCalls || [];
      for (const tc of toolCalls) {
        try {
          const db = getDb();
          db.insert(tool_call_logs).values({
            id: uuid(),
            tenant_id: opts.tenantId,
            agent_id: opts.agentId,
            conversation_id: opts.conversationId,
            message_id: '',
            tool_name: tc.toolName || tc.name || 'unknown',
            args: JSON.stringify(tc.args || {}),
            result: tc.result ? JSON.stringify(tc.result) : '',
            status: tc.status || 'success',
            duration_ms: tc.durationMs || 0,
            created_at: Date.now(),
          }).run();
        } catch {
          // 审计日志写入失败不阻塞主流程
        }
      }
      return args;
    },
  };
}
```

- [ ] **Step 2: 创建 Token 统计 Processor**

```typescript
// vico/server/src/agent/mastra/processors/token-tracker.ts
// Mastra output processor: Token 用量统计 → token_usage_logs 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { token_usage_logs } = schema;

interface TokenTrackerOptions {
  tenantId: string;
  agentId: string;
  modelName: string;
}

/**
 * 创建 Token 用量统计 output processor。
 * Mastra 每次 LLM 调用完成后触发，记录 prompt/completion token 数。
 */
export function createTokenTracker(opts: TokenTrackerOptions) {
  return {
    type: 'output' as const,
    name: 'token-tracker',
    async process(args: { result: any; usage?: { promptTokens: number; completionTokens: number } }) {
      const usage = args?.usage;
      if (usage) {
        try {
          const db = getDb();
          db.insert(token_usage_logs).values({
            id: uuid(),
            tenant_id: opts.tenantId,
            agent_id: opts.agentId,
            model_name: opts.modelName,
            prompt_tokens: usage.promptTokens || 0,
            completion_tokens: usage.completionTokens || 0,
            created_at: Date.now(),
          }).run();
        } catch {
          // Token 统计写入失败不阻塞主流程
        }
      }
      return args;
    },
  };
}
```

- [ ] **Step 3: 创建消息持久化 Processor**

```typescript
// vico/server/src/agent/mastra/processors/message-persister.ts
// Mastra input/output processor: 用户消息 + 助手回复 → messages 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { messages } = schema;

interface MessagePersisterOptions {
  conversationId: string;
}

/**
 * 创建消息持久化 processor。
 * input processor: 在请求进入时记录用户消息
 * output processor: 在流完成时记录助手回复
 */
export function createMessagePersister(opts: MessagePersisterOptions) {
  let userMessage = '';

  const inputProcessor = {
    type: 'input' as const,
    name: 'message-persister-input',
    async process(args: { messages?: Array<{ role: string; content: string }> }) {
      const msgs = args?.messages || [];
      // 取最后一条 user 消息
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        userMessage = lastUser.content;
        try {
          const db = getDb();
          db.insert(messages).values({
            id: uuid(),
            conversation_id: opts.conversationId,
            role: 'user',
            content: userMessage,
            created_at: Date.now(),
          }).run();
        } catch {
          // 消息持久化失败不阻塞主流程
        }
      }
      return args;
    },
  };

  const outputProcessor = {
    type: 'output' as const,
    name: 'message-persister-output',
    async process(args: { result: any; text?: string }) {
      const assistantText = args?.text || '';
      if (assistantText) {
        try {
          const db = getDb();
          db.insert(messages).values({
            id: uuid(),
            conversation_id: opts.conversationId,
            role: 'assistant',
            content: assistantText,
            created_at: Date.now(),
          }).run();
        } catch {
          // 消息持久化失败不阻塞主流程
        }
      }
      return args;
    },
  };

  return { inputProcessor, outputProcessor };
}
```

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/agent/mastra/processors/
git commit -m "feat: add Mastra processors - audit, token tracking, message persistence"
```

---

### Task 9: 创建 Agent Factory

**Files:**
- Create: `packages/server/src/agent/mastra/agent-factory.ts`

- [ ] **Step 1: 创建 Agent Factory 模块**

```typescript
// vico/server/src/agent/mastra/agent-factory.ts
// Vico Agent DB 配置 → Mastra Agent 实例构建器
// 整合 4 个 Bridge + 3 个 Processor，构建完整的 Mastra Agent

import { Agent } from '@mastra/core/agent';
import { withMastra } from '@mastra/ai-sdk';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';
import { resolveAgentModel } from './bridges/model-bridge.js';
import { getSkillToolsForMastraAgent, getSkillPromptForAgent } from './bridges/skill-bridge.js';
import { createRagTool, getRagContext } from './bridges/rag-bridge.js';
import { authToMastraContext, type MastraRuntimeContext } from './bridges/auth-bridge.js';
import { createAuditLogger } from './processors/audit-logger.js';
import { createTokenTracker } from './processors/token-tracker.js';
import { createMessagePersister } from './processors/message-persister.js';
import { getMastraStorage } from './storage.js';
import { shortTermMemory } from '../../memory/short-term.js';
import { longTermMemory } from '../../memory/long-term.js';
import { config } from '../../config.js';
import type { AuthContext } from '../../api/helpers.js';

const { agents, agent_knowledge_bases, conversations } = schema;

export interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}

/**
 * 将 Vico Agent 数据库配置构建为 Mastra Agent 实例。
 * 
 * 构建流程：
 * 1. 加载 Agent 数据库行
 * 2. 解析 LLM 模型 → Model Bridge
 * 3. 加载 Skill 工具 → Skill Bridge
 * 4. 创建 RAG 检索工具 → RAG Bridge
 * 5. 构建系统提示词（Agent prompt + Skill prompts + LTM + RAG）
 * 6. 创建 Mastra Agent 实例，注入 memory 和 processors
 */
export async function createMastraAgent(
  ctx: PipelineContext,
): Promise<{ agent: Agent; conversationId: string; modelName: string }> {
  const db = getDb();

  // 1. 加载 Agent 配置
  const agentRow = db.select().from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agentRow) throw new Error('Agent not found');

  // 2. 解析模型
  const { model, modelConfig } = resolveAgentModel(ctx.tenantId, agentRow.model_id);

  // 3. 创建或复用 Conversation
  let conversationId = ctx.conversationId;
  if (!conversationId) {
    conversationId = uuid();
    const now = Date.now();
    db.insert(conversations).values({
      id: conversationId,
      tenant_id: ctx.tenantId,
      agent_id: ctx.agentId,
      user_id: ctx.userId,
      title: '',
      model_name: modelConfig.model_name,
      created_at: now,
      updated_at: now,
    }).run();
  }

  // 4. 构建系统提示词（复用现有逻辑）
  const skillPrompts = getSkillPromptForAgent(ctx.agentId);
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, '');
  const ragContext = agentRow.rag_mode !== 'disabled'
    ? await getRagContext(ctx.agentId, '')
    : '';

  let systemPrompt = agentRow.system_prompt || '';
  if (skillPrompts) {
    systemPrompt += '\n\n## 技能指南\n' + skillPrompts;
  }
  if (ltmFacts.length > 0) {
    systemPrompt += '\n\n## 相关历史信息\n' + ltmFacts.map((f) => f.content).join('\n');
  }
  if (ragContext) {
    systemPrompt += ragContext;
  }

  // 5. 构建 tools（Skill tools + RAG tool）
  const skillTools = getSkillToolsForMastraAgent(ctx.agentId, {
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    userId: ctx.userId,
  });

  const ragTool = agentRow.rag_mode !== 'disabled'
    ? createRagTool(ctx.agentId, ctx.tenantId)
    : null;

  const tools: Record<string, any> = { ...skillTools };
  if (ragTool) {
    tools[ragTool.id] = ragTool;
  }

  // 6. 创建 Processors
  const mastraCtx = authToMastraContext(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    conversationId,
  );
  const { inputProcessor, outputProcessor } = createMessagePersister({ conversationId });
  const auditLogger = createAuditLogger({
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    conversationId,
  });
  const tokenTracker = createTokenTracker({
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    modelName: modelConfig.model_name,
  });

  // 7. 用 withMastra 包裹 model，注入 memory + processors
  const wrappedModel = withMastra(model as any, {
    memory: {
      storage: getMastraStorage(),
      threadId: mastraCtx.threadId,
      resourceId: mastraCtx.resourceId,
      lastMessages: config.memory.stm_window * 2,
    },
    inputProcessors: [inputProcessor],
    outputProcessors: [auditLogger, tokenTracker, outputProcessor],
  });

  // 8. 创建 Mastra Agent
  const agent = new Agent({
    name: agentRow.name,
    instructions: systemPrompt,
    model: wrappedModel,
    tools,
  });

  return {
    agent,
    conversationId,
    modelName: modelConfig.model_name,
  };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd vico/server && npx tsc --noEmit src/agent/mastra/agent-factory.ts 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/agent/mastra/agent-factory.ts
git commit -m "feat: add Agent Factory - Vico DB config to Mastra Agent"
```

---

### Task 10: 创建 Mastra 单例入口

**Files:**
- Create: `packages/server/src/agent/mastra/index.ts`

- [ ] **Step 1: 创建 Mastra 入口模块**

```typescript
// vico/server/src/agent/mastra/index.ts
// Mastra 实例管理：懒加载单例，初始化时注册动态 Agent

import { Mastra } from '@mastra/core';
import { getMastraStorage } from './storage.js';

let mastraInstance: Mastra;

/**
 * 获取 Mastra 实例单例。
 * Mastra 实例不与特定 Agent 绑定，Agent 通过 createMastraAgent() 动态创建。
 * Mastra 实例主要负责统一管理 storage 和全局配置。
 */
export function getMastra(): Mastra {
  if (!mastraInstance) {
    mastraInstance = new Mastra({
      storage: getMastraStorage(),
      agents: {},  // Agent 由 createMastraAgent() 动态创建，不在此处注册
    });
    console.log('[Mastra] Instance initialized');
  }
  return mastraInstance;
}

export { createMastraAgent } from './agent-factory.js';
export type { PipelineContext } from './agent-factory.js';
```

- [ ] **Step 2: Commit**

```bash
git add vico/server/src/agent/mastra/index.ts
git commit -m "feat: add Mastra singleton entry point"
```

---

### Task 11: 改造 Chat API + pipeline.ts

**Files:**
- Modify: `packages/server/src/api/chat.ts`
- Modify: `packages/server/src/agent/pipeline.ts`

- [ ] **Step 1: 改造 pipeline.ts，添加 feature flag 路由**

在 `packages/server/src/agent/pipeline.ts` 文件末尾添加 Mastra 委托逻辑：

```typescript
// 在文件末尾（runPipeline 函数之后）添加：

/**
 * 统一入口：根据 config.server.agent_engine 选择使用 Mastra 或 Legacy pipeline。
 * 前端和 API 路由层无需感知引擎切换。
 */
export async function runChatPipeline(
  message: string,
  ctx: PipelineContext,
): Promise<PipelineResult> {
  const engine = config.server.agent_engine || 'legacy';

  if (engine === 'mastra') {
    try {
      const { createMastraAgent } = await import('./mastra/index.js');
      const { agent, conversationId, modelName } = await createMastraAgent(ctx);

      const result = await agent.stream(message, {
        threadId: ctx.conversationId || '',
        resourceId: ctx.tenantId,
      });

      // 将 Mastra 流转换为与 legacy pipeline 兼容的 SSE ReadableStream
      return mastraStreamToPipelineResult(result, conversationId, ctx.agentId, modelName, message, ctx);
    } catch (err) {
      console.error('[Mastra] Error, falling back to legacy pipeline:', err);
      // Mastra 出错时自动回退到 legacy pipeline
    }
  }

  // Legacy pipeline
  return runPipeline(message, ctx);
}

/**
 * 将 Mastra Agent stream 结果转换为 Vico SSE 格式的 PipelineResult。
 * 保持 data: {"type":"text_delta","content":"..."}\n\n 格式不变。
 */
function mastraStreamToPipelineResult(
  mastraResult: any,
  conversationId: string,
  agentId: string,
  modelName: string,
  message: string,
  ctx: PipelineContext,
): PipelineResult {
  const encoder = new TextEncoder();
  let finalText = '';

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        // Mastra stream 可能是 ReadableStream 或 AsyncIterable
        if (mastraResult.textStream) {
          // AI SDK 兼容格式
          for await (const text of mastraResult.textStream) {
            finalText += text;
            const event = JSON.stringify({ type: 'text_delta', content: text });
            controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          }
        } else if (mastraResult[Symbol.asyncIterator]) {
          // AsyncIterable 格式
          for await (const chunk of mastraResult) {
            const text = chunk?.text || chunk?.content || chunk?.textDelta || '';
            if (text) {
              finalText += text;
              const event = JSON.stringify({ type: 'text_delta', content: text });
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            }
          }
        } else if (mastraResult.stream) {
          // ReadableStream 格式
          const reader = mastraResult.stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
            finalText += text;
            const event = JSON.stringify({ type: 'text_delta', content: text });
            controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          }
        }

        // 流完成
        const now = Date.now();
        const db = getDb();

        // 更新 conversation
        db.update(conversations).set({
          message_count: sql`message_count + 2`,
          updated_at: now,
        }).where(eq(conversations.id, conversationId)).run();

        // 更新短期记忆
        shortTermMemory.push(conversationId, { role: 'user', content: message, timestamp: now });
        shortTermMemory.push(conversationId, { role: 'assistant', content: finalText, timestamp: now });

        // 异步提取长期记忆
        if (config.memory.ltm_auto_extract) {
          longTermMemory.extractAndStore(ctx.tenantId, ctx.userId, [
            { role: 'user', content: message },
            { role: 'assistant', content: finalText },
          ]).catch(() => {});
        }

        const doneEvent = JSON.stringify({ type: 'done', usage: {} });
        controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
        controller.close();
      } catch (err: any) {
        const errorEvent = JSON.stringify({ type: 'error', message: err.message });
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        controller.close();
      }
    },
  });

  return {
    stream: readableStream,
    metadata: { conversationId, agentId, modelName },
  };
}
```

- [ ] **Step 2: 修改 chat.ts 路由，使用 runChatPipeline**

```typescript
// vico/server/src/api/chat.ts
import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { runChatPipeline } from '../agent/pipeline.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  app.post('/api/v1/chat', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    const { agentId, conversationId, message } = body;

    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    const result = await runChatPipeline(message, {
      tenantId: auth.tenantId,
      agentId,
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

关键变化：`runPipeline` → `runChatPipeline`（内部根据 feature flag 路由到 Mastra 或 Legacy）。

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd vico/server && npx tsc --noEmit 2>&1 | head -40
```

Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/api/chat.ts vico/server/src/agent/pipeline.ts
git commit -m "feat: add Mastra engine routing with feature flag fallback"
```

---

### Task 12: 集成测试 — 启动服务器验证

**Files:**
- (验证，不修改文件)

- [ ] **Step 1: 启动开发服务器**

```bash
cd vico/server && pnpm dev
```

Expected: 服务器正常启动，日志中可见 `[Mastra] Storage initialized: ...`（仅在首次请求触发 Mastra agent 创建时）。

- [ ] **Step 2: 测试 Legacy 模式 Chat API（默认）**

```bash
# 先登录获取 session cookie
curl -s -X POST http://localhost:3001/api/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  -c /tmp/vico-cookies.txt

# 发送 Chat 请求（legacy 模式）
curl -s -X POST http://localhost:3001/api/v1/chat \
  -H 'Content-Type: application/json' \
  -b /tmp/vico-cookies.txt \
  -d '{"agentId":"<替换为实际 agent id>","message":"你好"}' \
  --no-buffer
```

Expected: 返回 SSE 流，包含 `text_delta` 事件和最终 `done` 事件。确认 Legacy 模式正常工作。

- [ ] **Step 3: 切换到 Mastra 模式测试**

修改 `server.config.yaml` 中 `agent_engine: mastra`，重启服务器。

```bash
# 发送 Chat 请求（mastra 模式）
curl -s -X POST http://localhost:3001/api/v1/chat \
  -H 'Content-Type: application/json' \
  -b /tmp/vico-cookies.txt \
  -d '{"agentId":"<替换为实际 agent id>","message":"你好"}' \
  --no-buffer
```

Expected: 返回 SSE 流，格式与 Legacy 一致（`text_delta` + `done`），前端无需改动。

- [ ] **Step 4: 切回 Legacy 模式**

```bash
# 恢复 agent_engine: legacy
# 确认回退可用
```

- [ ] **Step 5: Commit（如有配置调整）**

```bash
git add vico/server/server.config.yaml
git commit -m "chore: set agent_engine to legacy as default"
```

---

### Task 13: 验证前端兼容性

**Files:**
- (验证，不修改文件)

- [ ] **Step 1: 启动前端开发服务器**

```bash
cd vico/web && pnpm dev
```

- [ ] **Step 2: 浏览器访问测试对话**

1. 登录 `http://localhost:5173/login`（admin / admin123）
2. 进入 Agent 管理，选择一个 Agent
3. 进入 "测试对话" Tab
4. 发送消息

Expected: 
- Legacy 模式：对话正常，流式输出无变化
- Mastra 模式：对话正常，流式输出无变化

- [ ] **Step 3: 验证对话记录**

1. 进入 "对话记录" 页面
2. 查看刚才的对话
3. 确认用户消息和 AI 回复都已记录

Expected: 两种模式下对话记录均正常。

---

### Task 14: 删除 __tests__ 占位目录，运行完整构建

**Files:**
- (验证，不修改业务文件)

- [ ] **Step 1: 完整构建验证**

```bash
cd vico/server && pnpm build
```

Expected: TypeScript 编译无错误。

- [ ] **Step 2: 清理 Feature Flag 配置，确保默认 Legacy**

确认 `server.config.yaml` 中 `agent_engine: legacy`，确保生产环境默认使用稳定引擎。

```bash
grep agent_engine vico/server/server.config.yaml
```

Expected: `agent_engine: legacy`

---

### Task 15: 最终 Commit

- [ ] **Step 1: 确认所有文件已提交**

```bash
cd /Users/taosikai/www/js/vico
git status
```

Expected: clean working tree。

- [ ] **Step 2: （如有未提交文件）最终 Commit**

```bash
git add -A
git commit -m "feat: complete Mastra Agent engine Phase 1 integration"
```
