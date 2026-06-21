# Mastra Memory 全面升级计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将自建 WorkingMemory/ObservationalMemory 迁移到 Mastra 原生 4 层 memory processors（MessageHistory + WorkingMemory + SemanticRecall + ObservationalMemory），删除自建实现，激活 Mastra 框架级 memory pipeline。

**Architecture:** 在 `getMemory()` 中配置 Mastra 原生 `workingMemory`、`semanticRecall`、`observationalMemory` 三项 processor；将 Memory 传入 Mastra 构造函数以激活框架级 pipeline；在 `chat.ts` 中接入 ObservationalMemory 的触发流程；迁移 `memory_entries` 历史数据到 Mastra Storage；最后删除自建实现。

**Tech Stack:** TypeScript, @mastra/memory@1.20.3, @mastra/core@1.42.0, @mastra/libsql@1.13.0, LibSQLStore, LibSQLVector

**参考 spec:** `docs/superpowers/specs/2026-06-13-mastra-agent-architecture-design.md` Section 5

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/agent/memory-setup.ts` | Modify | 配置 3 个 Mastra 原生 processor |
| `packages/server/src/mastra.ts` | Modify | 传入 memory 到 Mastra 构造函数 |
| `packages/server/src/chat/chat.ts` | Modify | 接入 OM 触发、删除自建 WorkingMemory 调用 |
| `packages/server/src/agent/agents/main.agent.ts` | Modify | 移除 `memory: getMemory()`（改由 Mastra 框架层注入） |
| `packages/server/src/agent/agents/agent-proxy.agent.ts` | Modify | 同上 |
| `packages/server/src/services/conversation/conversation-manager.ts` | Modify | 适配 Memory API 变更（如有） |
| `packages/server/src/agent/memory/working-memory.ts` | Delete | 淘汰自建实现 |
| `packages/server/src/agent/memory/observational-memory.ts` | Delete | 淘汰自建实现 |
| `packages/server/src/agent/memory/__tests__/working-memory.test.ts` | Delete | 淘汰对应测试 |
| `packages/server/src/agent/memory/__tests__/observational-memory.test.ts` | Delete | 淘汰对应测试 |

---

### Task 1: 配置 Mastra 原生 Memory Processors

**Files:**
- Modify: `packages/server/src/agent/memory-setup.ts`

**背景：** Mastra Memory 构造函数 `options` 中可启用三种 processor：
- `workingMemory` — `{ enabled: true, template: string, scope?: 'resource'|'thread' }`
- `semanticRecall` — `true | { topK: number, messageRange: {before, after}, scope?: 'resource'|'thread' }`
- `observationalMemory` — Mastra 内置 ObservationalMemory engine，自动 LLM 摘要 + 向量检索

当前 `getMemory()` 只配了 `lastMessages: 10`，需要补全。

**⚠️ 关键风险：** Mastra OM engine **默认使用 `google/gemini-2.5-flash`** 做摘要模型。如果环境没有 Google API key，OM 初始化会失败导致 Memory 不可用。必须显式覆盖 OM 模型为环境中可用的模型（如 `openai/gpt-4o-mini`）。

- [ ] **Step 1: 备份当前 memory-setup.ts 并记录关键状态**

```bash
cp vico/server/src/agent/memory-setup.ts vico/server/src/agent/memory-setup.ts.bak
```

- [ ] **Step 2: 修改 memory-setup.ts，补全 processor 配置**

读取当前 `packages/server/src/agent/memory-setup.ts`。

将 `getMemory()` 函数替换为以下实现：

```typescript
/**
 * Get or create the Mastra Memory singleton.
 *
 * Configures 4-layer memory architecture:
 * 1. MessageHistory — auto-injected via lastMessages (Mastra built-in)
 * 2. WorkingMemory — Markdown template, scope=resource (user-level)
 * 3. SemanticRecall — vector-based cross-thread recall, topK=5
 * 4. ObservationalMemory — LLM-based conversation observation + reflection
 *
 * All processors are auto-managed by Mastra's memory pipeline:
 * - Pre-request: WorkingMemory + SemanticRecall context auto-injected
 * - Post-request: Messages persisted, OM triggered when threshold crossed
 */
export function getMemory(): Memory {
  if (!_memory) {
    _memory = new Memory({
      storage: getStorage(),
      options: {
        lastMessages: 20,
        workingMemory: {
          enabled: true,
          template: `
# 用户信息
- **称呼**: 
- **位置**: 
- **职业**: 
- **兴趣**: 
- **目标**: 
- **偏好**: 
- **重要事项**: 
`,
        },
        semanticRecall: {
          topK: 5,
          messageRange: { before: 2, after: 2 },
        },
        observationalMemory: {
          // 必须显式指定 OM 模型，默认 gemini-2.5-flash 在无 Google key 的环境会失败
          model: 'openai/gpt-4o-mini',
          observation: {
            model: 'openai/gpt-4o-mini',
          },
          reflection: {
            model: 'openai/gpt-4o-mini',
          },
        },
      },
    });

    // 根据配置注入 embedder
    const { embedder, embedder_model } = config.rag;
    if (embedder === 'api') {
      try {
        _memory.setEmbedder(new ModelRouterEmbeddingModel(embedder_model));
        logger.info({ model: embedder_model }, 'Embedder configured (api)');
      } catch (err) {
        logger.error({ err, model: embedder_model }, 'Failed to create embedder');
      }
    } else {
      logger.warn({ model: embedder_model }, 'Local embedder not yet supported');
    }
  }
  return _memory;
}
```

**说明：**
- `lastMessages: 20`（从 10 增加到 20，匹配 config.memory.stm_window）
- `workingMemory.enabled: true` 激活 Mastra 原生 WorkingMemory processor
- `workingMemory.template` 使用中文 Markdown 模板，agent 会自动调用 `updateWorkingMemory` tool 更新
- `semanticRecall: { topK: 5, messageRange: {before:2, after:2} }` 激活向量语义回忆（每次请求自动检索最相关 5 条 + 上下文各 2 条）
- `observationalMemory: true` 启用 Mastra 内置的 Observation engine（默认使用 gemini-2.5-flash 做摘要）

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd vico/server && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no new errors from memory-setup.ts.

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/agent/memory-setup.ts
git commit -m "feat: configure Mastra native WorkingMemory, SemanticRecall, and ObservationalMemory processors"
```

---

### Task 2: 将 Memory 传入 Mastra 构造函数

**Files:**
- Modify: `packages/server/src/mastra.ts`

**背景：** Mastra 构造函数接受 `memory: Record<string, Memory>` 参数，注册后框架层自动管理 memory pipeline（注入/存储）。当前 `mastra.ts` 只传了 `storage`，memory 是各个 Agent 各自引用的，Mastra 框架级 pipeline 未激活。

- [ ] **Step 1: 修改 mastra.ts，添加 memory 注册**

将 `packages/server/src/mastra.ts` 中的 Mastra 实例化代码：

```typescript
import { getStorage } from './agent/memory-setup.js';
```

替换为：

```typescript
import { getStorage, getMemory } from './agent/memory-setup.js';
```

并将构造函数参数：

```typescript
export const mastra = new Mastra({
  agents: {
    mainAgent,
    agentProxy,
  },
  storage: getStorage(),
  observability: getObservabilityConfig(),
});
```

改为：

```typescript
export const mastra = new Mastra({
  agents: {
    mainAgent,
    agentProxy,
  },
  storage: getStorage(),
  memory: {
    memory: getMemory(),
  },
  observability: getObservabilityConfig(),
});
```

- [ ] **Step 2: 验证编译**

```bash
cd vico/server && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/mastra.ts
git commit -m "feat: register Memory in Mastra constructor to activate framework-level memory pipeline"
```

---

### Task 3: 移除 Agent 级别的 memory 配置

**Files:**
- Modify: `packages/server/src/agent/agents/main.agent.ts`
- Modify: `packages/server/src/agent/agents/agent-proxy.agent.ts`

**背景：** Memory 已在 Mastra 框架层注册（Task 2），每个 Agent 不需要再单独引用 `getMemory()`。Agent 构造函数的 `memory` 属性是用于覆盖框架级 memory 的 per-agent 配置。在迁移过渡期保留不传，让 Agent 使用 Mastra 框架级 memory。

- [ ] **Step 1: 修改 main.agent.ts**

移除 `memory: getMemory()` 行和对应的 import。

```typescript
// 删除这两行：
import {getMemory} from '../memory-setup.js';
// ...
  memory: getMemory(),
```

修改后的 agent 构造：

```typescript
import {Agent} from '@mastra/core/agent';
import {getWorkspace} from '../workspace-setup.js';
import type {MastraModelConfig} from '@mastra/core/llm';
import type {AgentDetail} from '../../services/agent/types.js';
import {buildMainAgentTools} from '../agent-tools.factory.js';

export const mainAgent = new Agent({
  id: 'main',
  name: 'Vico',
  description: '通用 AI 助手，能够理解任务、分派给专业 Agent、汇总结果',
  instructions: ({ requestContext }) => {
    return requestContext.get('instructions');
  },
  model: ({ requestContext }) => {
    const model = requestContext.get('model') as MastraModelConfig;
    if (!model) throw new Error('Model not configured for main agent');
    return model;
  },
  tools: async ({ requestContext }) => {
    const agentDetail = requestContext?.get('agentDetail') as AgentDetail | undefined;
    if (agentDetail) {
      return buildMainAgentTools(agentDetail);
    }
    return {};
  },
  workspace: getWorkspace(),
  defaultOptions: {
    maxSteps: 15,
  },
});
```

- [ ] **Step 2: 修改 agent-proxy.agent.ts**

同上，移除 `import {getMemory}` 和 `memory: getMemory()`。

- [ ] **Step 3: 验证编译**

```bash
cd vico/server && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/agent/agents/main.agent.ts vico/server/src/agent/agents/agent-proxy.agent.ts
git commit -m "refactor: remove per-agent memory config, rely on Mastra framework-level memory injection"
```

---

### Task 4: 改造 chat.ts — 移除自建 WorkingMemory 提取

**Files:**
- Modify: `packages/server/src/chat/chat.ts`

**背景：** 当前 `chat.ts` 在 `onComplete` 中手动调用 `workingMemory.extractAndStore()`（自建实现）。升级后：
1. Mastra 原生 WorkingMemory 由 agent 通过 `updateWorkingMemory` tool 自动管理，无需手动提取
2. Mastra 原生 MessageHistory 在 stream 调用时自动持久化（通过 `memory: { thread, resource }` 选项）
3. ObservationalMemory 由 Mastra 的 `getOutputProcessors` 自动管理 — 每次请求后自动检查 token 阈值，跨过阈值时异步触发 LLM 摘要，无需手动调用

- [ ] **Step 1: 修改 chat.ts**

删除自建 WorkingMemory 的 import 和调用，添加 ObservationalMemory 触发。

当前文件需要改两处：

**Import 区域** — 删除 `workingMemory` import：

```typescript
// 删除这行：
import {workingMemory} from '../agent/memory/working-memory.js';
```

**onComplete 回调** — 移除 WorkingMemory 提取逻辑。Mastra 原生 WorkingMemory 由 agent 通过 `updateWorkingMemory` tool 自动更新；OM 由 Mastra output processor 自动触发。`onComplete` 变为空操作：

```typescript
onComplete: async () => {
  // WorkingMemory + ObservationalMemory 均由 Mastra processor pipeline 自动管理
},
```

完整的 `executeAgentChat` 函数应变为：

```typescript
export async function executeAgentChat(params: ExecuteChatParams): Promise<Response> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const thread = threadId || `${agentId}::${userId}::${uuidv4()}`;

    const requestContext = new RequestContext();

    const ctx = agentId === 'main'
        ? await prepareMainAgentContext(tenantId, requestContext)
        : await prepareAgentContext(tenantId, agentId, requestContext);

    await saveThread(thread, tenantId, {
      agent_id: agentId,
      user_id: userId,
      model_name: ctx.agent.model_id,
    });

    const mastraAgentId = agentId === 'main' ? 'mainAgent' : 'agentProxy';
    const output: MastraModelOutput<unknown> = await mastra.getAgent(mastraAgentId).stream(
      [{ role: 'user', content: message }],
      {
        instructions: ctx.instructions,
        memory: { thread, resource: tenantId },
        maxSteps: ctx.agent.max_steps || 10,
        requestContext,
      },
    );

    const stream = createSSEStream(output, {
      doneMetadata: { threadId: thread },
      onComplete: async () => {
        // WorkingMemory + ObservationalMemory 均由 Mastra processor pipeline 自动管理
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An internal error occurred';
    logger.error({ err: error, agentId, tenantId }, 'Chat stream error');
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

同时删除不再需要的 `LanguageModel` import（原来用于 WorkingMemory 提取）：

```typescript
// 删除这行：
import type {LanguageModel} from 'ai';
```

删除不再需要的 `MastraModelConfig` import（原来也用于 WorkingMemory 提取时的类型转换）：

```typescript
// 删除这行（如果仅用于 onComplete 中的类型转换）：
import type {MastraModelConfig} from '@mastra/core/llm';
```

注意：检查 `MastraModelConfig` 是否在文件其他地方被使用（如第 70 行的 `activeModel` 变量），一并清理。

- [ ] **Step 2: 验证编译**

```bash
cd vico/server && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vico/server/src/chat/chat.ts
git commit -m "refactor: remove custom WorkingMemory extraction from chat flow, Mastra processors auto-manage memory"
```

---

### Task 5: 删除自建 Memory 实现

**Files:**
- Delete: `packages/server/src/agent/memory/working-memory.ts`
- Delete: `packages/server/src/agent/memory/observational-memory.ts`
- Delete: `packages/server/src/agent/memory/__tests__/working-memory.test.ts`
- Delete: `packages/server/src/agent/memory/__tests__/observational-memory.test.ts`

- [ ] **Step 1: 删除文件**

```bash
rm vico/server/src/agent/memory/working-memory.ts
rm vico/server/src/agent/memory/observational-memory.ts
rm -rf vico/server/src/agent/memory/__tests__
```

- [ ] **Step 2: 检查是否还有残留引用**

```bash
cd vico/server && grep -r "working-memory\|observational-memory" src/ --include="*.ts" | grep -v node_modules | grep -v ".bak"
```

Expected: no output（无残留引用）。如果 conversation-manager.ts 中有引用，需要在下一步处理。

- [ ] **Step 3: 检查 conversation-manager.ts 是否需要适配**

```bash
grep -n "workingMemory\|observationalMemory\|memory_entries" vico/server/src/services/conversation/conversation-manager.ts
```

如果 `conversation-manager.ts` 依赖了自建 memory 类，将其替换为 Mastra Memory API。预期 `conversation-manager.ts` 只使用 `getMemory().listThreads()` / `getMemory().getThreadById()` / `getMemory().recall()` / `getMemory().saveThread()`，这些 API 不变。

- [ ] **Step 4: 验证编译**

```bash
cd vico/server && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: 运行测试**

```bash
cd vico/server && pnpm test 2>&1 | tail -20
```

注意：如果之前有针对 working-memory/observational-memory 的测试，它们已被删除。剩下的测试（conversation-manager 等）应继续通过。

- [ ] **Step 6: 检查 memory_entries 表是否还有其他引用**

```bash
cd vico/server && grep -rn "memory_entries\|memoryEntries" src/ --include="*.ts" | grep -v node_modules | grep -v ".bak" | grep -v schema.ts
```

如果只有 `schema.ts` 中定义了表结构而其他无引用，可以保留表定义（用于未来可能的迁移脚本），但不影响运行。

- [ ] **Step 7: Commit**

```bash
git add vico/server/src/agent/memory/
git commit -m "refactor: remove custom WorkingMemory and ObservationalMemory, replaced by Mastra native processors"
```

---

### Task 6: 数据迁移脚本 — memory_entries → Mastra WorkingMemory

**Files:**
- Create: `packages/server/src/db/migrate-memory-entries.ts`

**背景：** 自建 `memory_entries` 表中的 `type='working'` 条目包含从对话中提取的用户事实。需要将这些文本内容注入 Mastra 原生 WorkingMemory。由于 Mastra WorkingMemory 是 template-based（Markdown 模板格式），需要将这些事实合并成符合模板格式的文本，通过 Mastra Memory API 写入。

- [ ] **Step 1: 创建迁移脚本**

创建 `packages/server/src/db/migrate-memory-entries.ts`:

```typescript
/**
 * 数据迁移脚本：memory_entries → Mastra WorkingMemory
 *
 * 将自建 memory_entries 表中 type='working' 的条目迁移到 Mastra 原生
 * WorkingMemory storage。Migration 以 resourceId（tenantId）为单位执行。
 *
 * 用法：在启动时自动执行，或通过 CLI 手动运行。
 */
import { getDb, schema } from './db.js';
import { getMemory } from '../agent/memory-setup.js';
import { eq, and } from 'drizzle-orm';
import logger from '../lib/logger.js';

const { memory_entries } = schema;

export async function migrateMemoryEntries(): Promise<{
  migrated: number;
  skipped: number;
  errors: number;
}> {
  const db = getDb();
  const memory = getMemory();
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  // 获取所有 type='working' 的条目，按 tenant 分组
  const entries = db.select().from(memory_entries)
    .where(eq(memory_entries.type, 'working'))
    .orderBy(memory_entries.tenant_id, memory_entries.user_id, memory_entries.importance)
    .all();

  logger.info({ count: entries.length }, 'Starting memory_entries migration');

  // 按 tenant_id + user_id 分组
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.tenant_id}::${entry.user_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(entry);
  }

  for (const [key, facts] of grouped) {
    const [tenantId, userId] = key.split('::');
    try {
      // 将 facts 格式化为 Mastra WorkingMemory 模板格式
      const content = facts
        .map((f) => `- ${f.content}`)
        .join('\n');

      // 通过 Memory API 写入 Mastra 原生 WorkingMemory
      const memoryStore = await memory.getMemoryStore();
      const existing = await memoryStore.getWorkingMemory({
        resourceId: tenantId,
        threadId: userId, // user-level scope
      });

      const merged = existing
        ? `${existing}\n${content}`
        : `# 用户信息\n${content}`;

      await memoryStore.setWorkingMemory({
        resourceId: tenantId,
        threadId: userId,
        data: merged,
      });

      // 删除已迁移的条目
      for (const f of facts) {
        db.delete(memory_entries).where(eq(memory_entries.id, f.id)).run();
      }

      migrated += facts.length;
      logger.info({ tenantId, userId, count: facts.length }, 'Migrated working memory entries');
    } catch (err) {
      errors += facts.length;
      logger.error({ err, tenantId, userId }, 'Failed to migrate memory entries');
    }
  }

  // 处理 type='observation' 条目 — 这些是规则生成的摘要，质量低，跳过
  const obsEntries = db.select({ id: memory_entries.id }).from(memory_entries)
    .where(eq(memory_entries.type, 'observation'))
    .all();

  skipped += obsEntries.length;
  logger.info({ skipped, migrated, errors }, 'Memory entries migration complete');

  return { migrated, skipped, errors };
}
```

- [ ] **Step 2: 在服务启动时调用迁移**

在 `packages/server/src/index.ts` 中添加迁移调用。找到 `await getStorage().init();` 之后添加：

```typescript
// 迁移自建 memory_entries 到 Mastra 原生 WorkingMemory
import { migrateMemoryEntries } from './db/migrate-memory-entries.js';
migrateMemoryEntries().catch(err => {
  logger.error({ err }, 'Memory entries migration failed');
});
```

- [ ] **Step 3: 验证编译**

```bash
cd vico/server && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/db/migrate-memory-entries.ts vico/server/src/index.ts
git commit -m "feat: add memory_entries to Mastra WorkingMemory data migration script"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动服务验证**

```bash
pnpm dev
```

Expected: server starts without errors, no memory-related crash.

- [ ] **Step 2: 发送对话验证 WorkingMemory**

通过聊天接口发送：
```
"我喜欢简洁的回复，不要太啰嗦"
```

然后发送：
```
"你还记得我的偏好吗？"
```

Expected: Agent 引用之前的偏好信息（Mastra 原生 WorkingMemory 自动注入）。

- [ ] **Step 3: 验证 SemanticRecall**

在一次对话中讨论某个主题，然后开启新对话，问 Agent 是否记得之前讨论的内容。

Expected: 如果语义相似，Agent 通过 SemanticRecall 能引用跨对话的记忆。

- [ ] **Step 4: 验证 ObservationalMemory 触发**

在同一个 thread 中发送 30+ 条消息（跨过 messageTokens 阈值），检查日志中是否有 OM 处理记录。或者检查 Mastra Storage 中是否有 observation 生成。

- [ ] **Step 5: 回归测试**

```bash
cd vico/server && pnpm test
```

Expected: 所有保留的测试通过（conversation-manager 等）。

- [ ] **Step 6: 清理备份文件**

```bash
rm vico/server/src/agent/memory-setup.ts.bak
```

- [ ] **Step 7: 最终 Commit**

```bash
git add -A
git commit -m "chore: cleanup migration artifacts and verify memory upgrade"
```

---

## Verification Checklist

- [ ] `cd packages/server && pnpm tsc --noEmit` — 无类型错误
- [ ] `pnpm dev` — 服务正常启动
- [ ] Mastra 原生 WorkingMemory — agent 可自动存储/更新/检索用户信息
- [ ] SemanticRecall — 跨对话语义回忆可用
- [ ] ObservationalMemory — 长对话自动触发观察摘要
- [ ] 自建 `WorkingMemory` / `ObservationalMemory` 类已删除，无残留引用
- [ ] `memory_entries` 中 `type='working'` 数据已迁移
- [ ] conversation-manager API 未受影响（listThreads / getThreadById / recall 正常）
- [ ] SSE 流式响应格式不变，前端无感
- [ ] `cd packages/server && pnpm test` — 现有测试通过

## Rollback Plan

如升级后出现问题，回退步骤：

1. 恢复 `memory-setup.ts` 备份：
   ```bash
   git checkout HEAD~5 -- vico/server/src/agent/memory-setup.ts
   ```
2. 恢复 `mastra.ts`、`main.agent.ts`、`agent-proxy.agent.ts`
3. 恢复 `chat.ts`
4. 恢复被删除的 `working-memory.ts` 和 `observational-memory.ts`
5. `memory_entries` 迁移数据可通过备份或 git reflog 恢复
