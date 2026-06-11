# TypeScript 后端最佳实践

## 一、项目结构

### 目录规范

```
packages/server/src/
├── index.ts              # 入口：Hono 启动、中间件链、启动流程
├── config.ts             # YAML 配置加载（含环境变量插值）
├── api/                  # 路由层 —— 仅做参数提取、鉴权、调用 service、返回响应
│   ├── router.ts         # 路由注册入口
│   ├── helpers.ts        # 共享辅助（如 getAuthContext）
│   ├── auth.ts           # 认证相关路由
│   ├── agents.ts         # Agent CRUD 路由
│   ├── ...
├── agent/                # Agent 引擎（核心业务逻辑）
│   ├── pipeline.ts       # 聊天管道编排
│   ├── tool-executor.ts  # 工具执行器
│   └── model-registry.ts # 模型管理
├── skill/                # Skill 插件系统
│   ├── types.ts          # 类型定义
│   ├── loader.ts         # 文件系统加载
│   └── manager.ts        # 生命周期管理
├── memory/               # 记忆系统
│   ├── short-term.ts     # 短期记忆
│   ├── long-term.ts      # 长期记忆
│   ├── rag.ts            # RAG 检索增强
│   └── embedder.ts       # 嵌入器
├── auth/                 # 认证
│   ├── index.ts          # better-auth 配置
│   └── seed.ts           # 默认租户/用户 seed
└── data/                 # 数据层
    ├── db.ts             # 数据库连接（单例）
    ├── schema.ts         # 业务表 Drizzle Schema
    ├── auth-schema.ts    # better-auth Drizzle Schema
    ├── migrate.ts        # 迁移执行器
    └── run-migrations.ts # 入口调用
```

### 分层原则

| 层 | 职责 | 禁止 |
|----|------|------|
| `api/` (路由) | 参数校验、鉴权、调用下层、返回响应 | 不要在路由中写业务逻辑 |
| `agent/`, `skill/`, `memory/` (核心) | 业务逻辑、编排、算法 | 不要直接操作 Hono Context |
| `data/` (数据) | 数据库连接、Schema、迁移 | 不要包含业务逻辑 |

```
请求 → 中间件链(CORS/限流/Session/Auth Guard)
     → 路由(api/)
       → getAuthContext(c) → 提取 { tenantId, userId }
         → 核心模块(agent/skill/memory) → 执行业务
           → 数据层(data/) → Drizzle ORM → SQLite
     → Response(json / SSE stream)
```

---

## 二、路由层规范

### 2.1 路由文件签名

每个路由文件导出注册函数，通过 `router.ts` 统一注册：

```typescript
// ✅ 标准路由文件签名
import { Hono } from 'hono';
import type { Variables } from '../index.js';

export function agentRoutes(app: Hono<{ Variables: Variables }>) {
  // 在此注册路由
}
```

```typescript
// router.ts —— 统一注册
import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { agentRoutes } from './agents.js';
// ...

export function registerRoutes(app: Hono<{ Variables: Variables }>) {
  agentRoutes(app);
  skillRoutes(app);
  // ...
}
```

### 2.2 Auth Context 提取

**每个 `/api/v1/*` 路由的第一行必须是 `getAuthContext(c)`：**

```typescript
import { getAuthContext } from './helpers.js';

app.get('/api/v1/agents', (c) => {
  const auth = getAuthContext(c);
  if (auth instanceof Response) return auth;  // 未认证，直接返回 401

  // auth.tenantId, auth.userId 可直接使用
  const rows = db.select().from(agents)
    .where(eq(agents.tenant_id, auth.tenantId))
    .all();
  return c.json(rows);
});
```

**`getAuthContext` 永远在第一行调用，不允许延迟到需要时才调用。** 路由层不自行解析 session。

### 2.3 响应规范

```typescript
// ✅ 成功返回
return c.json(data);                          // 200
return c.json({ id, message: 'created' });    // 200 (创建成功)
return c.json({ message: 'updated' });        // 200 (更新成功)
return c.json({ message: 'deleted' });        // 200 (删除成功)

// ✅ 错误返回
return c.json({ error: 'Agent not found' }, 404);
return c.json({ error: 'Unauthorized' }, 401);
return c.json({ error: 'agentId and message are required' }, 400);
```

### 2.4 路由处理函数模式

```typescript
// ✅ GET 列表：查询 + 富化 + 返回
app.get('/api/v1/agents', (c) => {
  const auth = getAuthContext(c);
  if (auth instanceof Response) return auth;
  const db = getDb();
  const rows = db.select().from(agents)
    .where(eq(agents.tenant_id, auth.tenantId))
    .orderBy(desc(agents.updated_at))
    .all();
  // 可在此富化关联数据
  return c.json(rows);
});

// ✅ GET 详情：查询 + 关联 + 404 守卫
app.get('/api/v1/agents/:id', (c) => {
  const auth = getAuthContext(c);
  if (auth instanceof Response) return auth;
  const id = c.req.param('id');
  const db = getDb();

  const agent = db.select().from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenant_id, auth.tenantId)))
    .get();

  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

// ✅ POST 创建：校验 → 生成 ID → 插入 → 返回
app.post('/api/v1/agents', async (c) => {
  const auth = getAuthContext(c);
  if (auth instanceof Response) return auth;
  const body = await c.req.json();
  const { name } = body;

  if (!name?.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.insert(agents).values({
    id, tenant_id: auth.tenantId, name,
    created_at: now, updated_at: now,
  }).run();
  return c.json({ id, message: 'created' });
});

// ✅ PATCH 更新：查询 → 白名单校验 → 更新
app.patch('/api/v1/agents/:id', async (c) => {
  const auth = getAuthContext(c);
  if (auth instanceof Response) return auth;
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = getDb();

  const agent = db.select().from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenant_id, auth.tenantId)))
    .get();
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  // 白名单控制可更新字段
  const allowed = ['name', 'system_prompt', 'model_id', 'temperature', 'max_tokens', 'rag_mode', 'enabled'];
  const updateData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed.includes(k) && v !== undefined) {
      updateData[k] = v;
    }
  }

  if (Object.keys(updateData).length > 0) {
    updateData.updated_at = Date.now();
    db.update(agents).set(updateData)
      .where(and(eq(agents.tenant_id, auth.tenantId), eq(agents.id, id)))
      .run();
  }
  return c.json({ message: 'updated' });
});

// ✅ DELETE 删除：查询存在 → 级联清理关联 → 删除
app.delete('/api/v1/agents/:id', (c) => {
  const auth = getAuthContext(c);
  if (auth instanceof Response) return auth;
  const id = c.req.param('id');
  const db = getDb();

  // 先清关联表
  db.delete(agent_skills).where(eq(agent_skills.agent_id, id)).run();
  db.delete(agent_knowledge_bases).where(eq(agent_knowledge_bases.agent_id, id)).run();
  // 再删主记录（带租户校验）
  db.delete(agents)
    .where(and(eq(agents.id, id), eq(agents.tenant_id, auth.tenantId)))
    .run();
  return c.json({ message: 'deleted' });
});
```

### 2.5 路由层禁止事项

- **不要在路由中写复杂业务逻辑** —— 提取到 `agent/`、`skill/` 等核心模块
- **不要裸写复杂 SQL** —— 用 Drizzle ORM 查询 API
- **不要重复 `getAuthContext` 之后的鉴权逻辑** —— auth guard 中间件已校验 session
- **不要吞掉错误** —— 让异常自然冒泡，Hono 会返回 500

---

## 三、数据库规范

### 3.1 连接获取

```typescript
import { getDb, schema, getSqlite } from '../data/db.js';

// ✅ 标准 CRUD —— 用 Drizzle 实例
const db = getDb();
const { agents, conversations } = schema;

// ✅ BLOB/向量操作 —— 用原始 SQLite 连接
const sqlite = getSqlite();
```

### 3.2 查询模式

```typescript
// ✅ 条件查询
const agent = db.select().from(agents)
  .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
  .get();

// ✅ 列表查询 + 排序
const rows = db.select().from(agents)
  .where(eq(agents.tenant_id, tenantId))
  .orderBy(desc(agents.updated_at))
  .all();

// ✅ 插入
const id = uuid();
const now = Date.now();
db.insert(agents).values({
  id, tenant_id: tenantId, name,
  created_at: now, updated_at: now,
}).run();

// ✅ 更新
db.update(agents).set({ name: 'new name', updated_at: Date.now() })
  .where(and(eq(agents.tenant_id, tenantId), eq(agents.id, id)))
  .run();

// ✅ 删除
db.delete(agents)
  .where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
  .run();

// ✅ Upsert（冲突时更新）
db.insert(agent_skills).values({
  agent_id: id, skill_name: name, config: '{}',
}).onConflictDoUpdate({
  target: [agent_skills.agent_id, agent_skills.skill_name],
  set: { config: '{}' },
}).run();

// ✅ SQL 表达式（自增计数）
db.update(conversations).set({
  message_count: sql`message_count + 2`,
  updated_at: now,
}).where(eq(conversations.id, conversationId)).run();
```

### 3.3 数据规范

| 规范 | 说明 |
|------|------|
| 主键 | 统一用 `uuid()` 生成，不用自增 |
| 时间戳 | `Date.now()` 存储 Unix 毫秒数 |
| JSON 字段 | 插入时 `JSON.stringify()`，读取后 `JSON.parse()` |
| Boolean 字段 | SQLite 无 bool，用 `0`/`1`（Drizzle integer 类型） |
| snaked_case 列名 | Schema 列名用 `snake_case`，与数据库一致 |
| 租户隔离 | 所有业务查询必须带 `eq(table.tenant_id, auth.tenantId)` |
| 级联删除 | 手动执行关联表删除（SQLite FK 不保证级联行为一致） |

---

## 四、单例与服务模式

### 4.1 模块级单例（Manager 类）

```typescript
// ✅ 标准 Manager 单例模式
class SkillManager {
  private registry: Map<string, SkillRegistryEntry> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;   // 幂等
    this.initialized = true;
    // 初始化逻辑...
  }

  getAllManifests() { /* ... */ }
  getToolsForAgent(agentId: string) { /* ... */ }
}

// 模块级导出单例实例
export const skillManager = new SkillManager();
```

**现有单例清单：** `skillManager`、`toolExecutor`、`shortTermMemory`、`longTermMemory`、`ragManager`、`getDb()`、`getEmbedder()`

### 4.2 懒初始化（数据库连接）

```typescript
let drizzleDb: ReturnType<typeof drizzle<typeof combinedSchema>>;

export function getDb() {
  if (!drizzleDb) {
    const sqlite = new Database(config.database.path);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    drizzleDb = drizzle(sqlite, { schema: combinedSchema });
  }
  return drizzleDb;
}
```

### 4.3 何时用单例

- 需要维护内存缓存/状态的模块 → 单例
- 纯工具函数/无状态逻辑 → 直接导出函数
- 数据库连接 → 懒初始化单例

---

## 五、配置管理

### 5.1 配置文件

```typescript
// config.ts —— 模块级导出，全局可用
export const config = loadConfig();

// 使用
import { config } from '../config.js';
console.log(config.server.port);
```

### 5.2 配置接口定义

```typescript
// ✅ 用 interface 定义完整配置类型
interface AppConfig {
  server: {
    port: number;
    deploy_mode: 'private' | 'saas';
  };
  memory: {
    stm_window: number;
    ltm_auto_extract: boolean;
    ltm_max_entries: number;
  };
  // ...
}
```

### 5.3 环境变量插值

YAML 中 `${ENV_VAR}` 语法自动替换：

```yaml
# server.config.yaml
llm:
  models:
    - provider: openai
      model_name: gpt-4o
      api_key: ${OPENAI_API_KEY}
```

```typescript
function resolveEnv(value: string): string {
  if (value.startsWith('${') && value.endsWith('}')) {
    const envKey = value.slice(2, -1);
    return process.env[envKey] || value;
  }
  return value;
}
```

---

## 六、中间件规范

### 6.1 中间件链顺序

```typescript
// index.ts —— 中间件注册顺序即为执行顺序
app.use('*', cors(...));             // 1. CORS
app.use('*', rateLimitMiddleware);   // 2. 限流
app.get('/health', healthCheck);     // 3. 健康检查（跳过后续）
app.use('*', sessionMiddleware);     // 4. Session 注入
app.use('/api/v1/*', authGuard);     // 5. Auth 守卫
app.on(['POST','GET'], '/api/auth/*', auth.handler); // 6. better-auth
registerRoutes(app);                 // 7. 业务路由
```

### 6.2 中间件编写

```typescript
// ✅ 标准 Hono 中间件模式
app.use('*', async (c, next) => {
  // 前置处理
  const session = c.get('session');
  if (skipCondition) return next();  // 跳过本中间件

  // 核心逻辑
  const result = await doSomething(c);

  // 注入上下文
  c.set('key', result);

  // 继续到下一个中间件/路由
  await next();
});
```

### 6.3 Auth Guard 模式

```typescript
// ✅ 路由守卫 —— 校验失败直接返回 401，不调用 next()
app.use('/api/v1/*', async (c, next) => {
  const session = c.get('session');
  const user = c.get('user');
  if (!session || !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  // 自动选择活跃组织（private 部署模式兼容）
  if (!session.activeOrganizationId) {
    // 查询用户第一个组织并设置
  }
  return next();
});
```

---

## 七、SSE 流式响应

### 7.1 SSE 响应格式

```typescript
// ✅ 标准 SSE 流模式
const encoder = new TextEncoder();
const readableStream = new ReadableStream({
  async start(controller) {
    try {
      // 逐块推送事件
      for await (const chunk of asyncIterator) {
        const event = JSON.stringify({ type: 'text_delta', content: chunk });
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      // 完成事件
      const doneEvent = JSON.stringify({ type: 'done', usage: {} });
      controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
      controller.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const errorEvent = JSON.stringify({ type: 'error', message: msg });
      controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
      controller.close();
    }
  },
});

// 返回 SSE Response
return new Response(readableStream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
});
```

### 7.2 事件类型

| 事件 | 格式 | 说明 |
|------|------|------|
| `text_delta` | `{ type: 'text_delta', content: string }` | 增量文本片段 |
| `done` | `{ type: 'done', usage: object }` | 流结束（含 token 用量） |
| `error` | `{ type: 'error', message: string }` | 错误信息 |

---

## 八、类型安全

### 8.1 类型定义位置

```typescript
// ✅ 模块专属类型 —— 定义在模块的 types.ts 中
// skill/types.ts
export interface SkillManifest { /* ... */ }
export interface SkillTool { /* ... */ }

// ✅ 跨模块共享的接口 —— 定义在使用方或公共处
// agent/pipeline.ts
export interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}
```

### 8.2 避免 any

```typescript
// ❌ 避免
function handle(data: any) { /* ... */ }
catch (err: any) { console.log(err.message); }

// ✅ 优先
function handle(data: Record<string, unknown>) { /* ... */ }
catch (err: unknown) {
  const msg = err instanceof Error ? err.message : 'Unknown error';
}
```

### 8.3 JSON 字段处理

```typescript
// 存储：显式序列化
config: JSON.stringify(configOverride)

// 读取：显式解析
const config = JSON.parse(row.config);

// 声明类型时标注 JSON 字段为 string
// config: string  (not object — it's stored as JSON text)
```

---

## 九、错误处理

### 9.1 路由层

```typescript
// ✅ 路由层不写 try-catch，Hono 自动处理 500
// 仅在需要特定错误信息时 catch 并返回
app.post('/api/v1/chat', async (c) => {
  const body = await c.req.json();
  // 参数校验 —— 提前返回
  if (!body.agentId || !body.message) {
    return c.json({ error: 'agentId and message are required' }, 400);
  }
  // 业务逻辑 —— 异常自然冒泡到 Hono
  const result = await runPipeline(body.message, ctx);
  return new Response(result.stream, { headers: {...} });
});
```

### 9.2 核心模块

```typescript
// ✅ 核心模块可以 try-catch 做降级处理
async execute(toolName: string, args: unknown, context: ToolContext) {
  try {
    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
    return await tool.handler(parsedArgs, context);
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}
```

### 9.3 非关键路径

```typescript
// ✅ 非关键异步操作 —— 静默失败不影响主流程
longTermMemory.extractAndStore(ctx.tenantId, ctx.userId, messages)
  .catch(() => {});  // LTM 提取失败不阻塞对话
```

---

## 十、ESM 导入规范

### 10.1 文件扩展名

```typescript
// ✅ 始终带 .js 扩展名（ESM 规范）
import { config } from './config.js';
import { getDb } from '../data/db.js';
import type { Variables } from '../index.js';
```

### 10.2 导入顺序

```typescript
// 1. Node 内置模块
import { readFileSync, existsSync } from 'node:fs';

// 2. 第三方库
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';

// 3. 本地模块（类型导入最后）
import { config } from '../config.js';
import { getAuthContext } from './helpers.js';
import type { Variables } from '../index.js';
```

---

## 十一、命名规范

| 类型 | 命名 | 示例 |
|------|------|------|
| 路由文件 | `kebab-case.ts` | `agent-skills.ts`、`knowledge-bases.ts` |
| 路由注册函数 | `xxxRoutes` | `agentRoutes`、`skillRoutes` |
| Manager 类 | `PascalCase` | `SkillManager`、`ToolExecutor` |
| 单例实例 | `camelCase` | `skillManager`、`toolExecutor` |
| 接口/类型 | `PascalCase` | `AuthContext`、`PipelineContext` |
| 数据库表变量 | `snake_case` | `agent_skills`、`knowledge_bases` |
| 函数 | `camelCase` | `getAuthContext`、`runPipeline` |

---

## 十二、启动流程规范

```typescript
// index.ts main() —— 初始化步骤按依赖关系排序
async function main() {
  runMigrations();                       // 1. 数据库迁移（必须先于 DB 操作）
  await skillManager.init();             // 2. Skill 扫描加载（需在路由注册前完成）
  await seedDefaultOrgAndAdmin();        // 3. 默认数据 seed

  const app = new Hono<{ Variables: Variables }>();

  // 中间件注册（顺序敏感）
  app.use('*', cors(...));
  app.use('*', rateLimiter);
  app.get('/health', ...);
  app.use('*', sessionMiddleware);
  app.use('/api/v1/*', authGuard);
  app.on(['POST','GET'], '/api/auth/*', auth.handler);

  // 业务路由注册
  registerRoutes(app);

  // 启动
  serve({ fetch: app.fetch, port: config.server.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**新增初始化步骤时，插入到依赖关系正确的位置，不要随意追加到末尾。**

---

## 十三、开发 Skill 规范

### 13.1 Skill 目录结构

```
skills/my-skill/
├── manifest.json     # 元数据（name 唯一标识、displayName 显示名、version、parameters）
├── prompt.md         # 系统提示词片段（Markdown 格式，注入到 Agent system prompt）
├── tools.ts          # 工具定义 + 处理函数（export default SkillTool[]）
└── resources/        # 知识文档（可选，安装时自动索引到知识库）
```

### 13.2 manifest.json

```json
{
  "name": "web-search",
  "displayName": "网页搜索",
  "version": "1.0.0",
  "description": "让 Agent 具备搜索网页的能力",
  "category": "搜索",
  "parameters": {
    "api_key": {
      "type": "string",
      "label": "API Key",
      "default": "",
      "required": true
    }
  },
  "enabled": true
}
```

### 13.3 tools.ts

```typescript
import type { SkillTool } from '../../server/src/skill/types.js';

const tools: SkillTool[] = [
  {
    definition: {
      name: 'web_search',
      description: '搜索互联网获取最新信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
    handler: async (args: { query: string }, context) => {
      // context.tenantId, context.agentId, context.skillConfig, context.userId
      const apiKey = context.skillConfig.api_key;
      // 执行搜索逻辑...
      return { results: [...] };
    },
  },
];

export default tools;
```

---

## 十四、常见错误与避免

| 错误 | 正确做法 |
|------|---------|
| 路由中写 100 行业务逻辑 | 提取到 `agent/`、`skill/` 模块 |
| 使用 `any` 类型 | `Record<string, unknown>` 或 `unknown` + 类型守卫 |
| 忘记 `tenant_id` 过滤 | 所有业务查询必须带 `eq(table.tenant_id, auth.tenantId)` |
| ESM 导入不带 `.js` | 始终写 `.js` 扩展名 |
| 在路由中直接操作 session | 通过 `getAuthContext(c)` 获取 |
| try-catch 吞掉所有错误 | 仅非关键路径可静默；关键路径让异常冒泡 |
| 用自增 ID | 统一用 `uuid()` |
| Schema 列名用 camelCase | 用 `snake_case` 与数据库一致 |
| 忘记手动级联删除关联表 | SQLite 的 FK 行为在不同版本不一致，统一手动处理 |
