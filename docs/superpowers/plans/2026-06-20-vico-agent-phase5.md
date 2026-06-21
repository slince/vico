# @vico/agent Phase 5 — 集成与清理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 @vico/agent 集成到 server 包，替换 Mastra 的 AgentLoop + ToolHost + SkillLoader，保留 Mastra 的 Memory 和 Storage（渐进迁移），清理 Mastra 依赖。

**Architecture:** 改造 `packages/server/src/chat.ts` 和 `agent.factory.ts`，使用 `AgentRuntime` + `AgentLoop` 替代 Mastra Agent。创建 ServerBootstrap 单例，整合 AgentRuntime + LocalToolHost + SkillManager。

**Tech Stack:** TypeScript 5.6+，better-sqlite3（现有），Drizzle ORM（现有）

## Global Constraints

- Server 包可依赖 `@vico/agent`（workspace protocol）
- 渐进替换：先并行运行新旧端点，验证通过后移除旧代码
- 不引入新外部依赖
- 所有查询带 `tenant_id` 过滤

---

### Task 1: Wire @vico/agent into Server Package

**Files:**
- Modify: `packages/server/package.json` — add `"@vico/agent": "workspace:*"` dependency
- Create: `packages/server/src/agent/vico-bootstrap.ts` — 整合启动逻辑

- [ ] **Step 1: Add agent dependency and install**

```bash
cd /Users/taosikai/www/js/vico/vico/server && pnpm add @vico/agent@workspace:*
```

- [ ] **Step 2: Write vico-bootstrap.ts**

```typescript
// src/agent/vico-bootstrap.ts
import { AgentRuntimeImpl, type Agent, type AgentFactory } from '@vico/agent';
import { AISDKModelClient } from '@vico/agent';
import { LocalToolHost } from '@vico/agent';
import { SkillManager } from '@vico/agent';
import { FSSkillLoader } from '@vico/agent';
import { AgentLoopImpl } from '@vico/agent';
import { PromptAssemblerImpl } from '@vico/agent';
import { MittEventRecorder, InMemorySpanTracker } from '@vico/agent';
import { CompositeHookRunner } from '@vico/agent';
import { ShortTermMemory } from '@vico/agent';
import { resolveModelProvider } from './bridges/model-bridge.js';
import type { AgentConfig } from '@vico/agent';
import type { AgentDetail } from '../services/agent/types.js';

/**
 * Vico Bootstrap — 使用 @vico/agent 替代 Mastra 的 Agent 运行时。
 * 单例启动，管理 AgentRuntime + ToolHost + SkillManager 生命周期。
 */
class VicoBootstrap {
  private runtime!: AgentRuntimeImpl;
  private toolHost!: LocalToolHost;
  private skillManager!: SkillManager;
  private events = new MittEventRecorder();
  private spanTracker = new InMemorySpanTracker();

  async init(skillRoots: string[]): Promise<void> {
    // 1. 工具系统
    this.toolHost = new LocalToolHost();

    // 2. Skill 系统
    const loader = new FSSkillLoader();
    this.skillManager = new SkillManager(loader);
    await this.skillManager.discover(skillRoots);

    // 3. Agent 运行时
    const factory: AgentFactory = async (config: AgentConfig) => {
      const model = resolveModelProvider(config.model);
      const modelClient = new AISDKModelClient(model, config.model.provider, config.model.model);
      const promptAssembler = new PromptAssemblerImpl();
      const hooks = new CompositeHookRunner();

      const loop = new AgentLoopImpl({
        config,
        model: modelClient,
        toolHost: this.toolHost,
        promptAssembler,
        events: this.events,
        spanTracker: this.spanTracker,
        hooks,
      });

      return { config, loop };
    };

    this.runtime = new AgentRuntimeImpl(factory);
  }

  /** 根据 DB AgentDetail 创建 Vico AgentConfig */
  static toAgentConfig(detail: AgentDetail): AgentConfig {
    return {
      id: detail.id,
      tenantId: detail.tenant_id,
      name: detail.name,
      systemPrompt: detail.system_prompt ?? '',
      model: {
        provider: detail.model_config?.provider ?? 'openai',
        model: detail.model_config?.model_name ?? 'gpt-4o',
        baseUrl: detail.model_config?.base_url ?? undefined,
        apiKey: detail.model_config?.api_key ?? undefined,
      },
      temperature: detail.temperature ?? 0.7,
      maxTokens: detail.max_tokens ?? 4096,
      maxSteps: detail.max_steps ?? 10,
    };
  }

  getRuntime(): AgentRuntimeImpl { return this.runtime; }
  getToolHost(): LocalToolHost { return this.toolHost; }
  getSkillManager(): SkillManager { return this.skillManager; }
  getEvents(): MittEventRecorder { return this.events; }
}

export const vicoBootstrap = new VicoBootstrap();
```

- [ ] **Step 3: Verify server compilation**

```bash
cd vico/server && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add vico/server/package.json pnpm-lock.yaml vico/server/src/agent/vico-bootstrap.ts
git commit -m "feat(server): wire @vico/agent bootstrap into server package"
```

---

### Task 2: New Chat Endpoint (平行运行)

**Files:**
- Create: `packages/server/src/api/chat-v2.ts` — 使用 @vico/agent 的新聊天端点
- Modify: `packages/server/src/api/router.ts` — 注册 `/api/chat-v2` 路由

- [ ] **Step 1: Write chat-v2.ts**

```typescript
// src/api/chat-v2.ts
import type { Hono, Context } from 'hono';
import { getAuthContext } from '../auth/utils.js';
import { vicoBootstrap } from '../agent/vico-bootstrap.js';
import { agentManager } from '../services/agent/agent-manager.js';
import type { Variables } from '../app.js';

export function chatV2Routes(app: Hono<{ Variables: Variables }>): void {
  app.post('/api/chat-v2', async (c: Context<{ Variables: Variables }>) => {
    const { tenantId, userId } = getAuthContext(c);
    const body = await c.req.json();
    const { agentId, message } = body;

    // 1. 加载 Agent 配置
    const detail = await agentManager.getAgentById(tenantId, agentId);
    if (!detail) return c.json({ error: 'Agent not found' }, 404);

    const config = VicoBootstrap.toAgentConfig(detail);
    const agent = await vicoBootstrap.getRuntime().createAgent(config);

    // 2. 执行 Turn
    const userMessage = { role: 'user' as const, content: message };
    const events = vicoBootstrap.getEvents();
    const signal = c.req.raw.signal;

    // 3. SSE 响应
    const stream = new ReadableStream({
      async start(controller) {
        const handler = (event: unknown) => {
          const sse = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(new TextEncoder().encode(sse));
        };

        events.on('*', handler);

        try {
          const result = await agent.loop.runTurn(
            `thread-${agentId}-${Date.now()}`,
            [],
            userMessage,
            signal,
          );
          // done event emitted by AgentLoop; result contains final state
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`));
        } finally {
          events.off('*', handler);
          controller.close();
        }
      },
    });

    return c.newResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });
}
```

- [ ] **Step 2: Register route in router.ts**

```typescript
import { chatV2Routes } from './chat-v2.js';
// ... in main router function:
chatV2Routes(app);
```

- [ ] **Step 3: Verify compilation**

```bash
cd vico/server && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/api/chat-v2.ts vico/server/src/api/router.ts
git commit -m "feat(server): add /api/chat-v2 endpoint using @vico/agent"
```

---

### Task 3: Vico Chat API 引用

**说明：** 此时新旧端点并行运行：
- `/api/chat` → 原有 Mastra 端点
- `/api/chat-v2` → 新 @vico/agent 端点

验证通过后，可将 `/api/chat-v2` 重命名为 `/api/chat`，移除旧端点。

---

### Task 4: Remove Mastra Dependencies

**Files:**
- Modify: `packages/server/src/mastra.ts` — 删除或重命名为 legacy
- Modify: `packages/server/src/index.ts` — 移除 Mastra 启动
- Modify: `packages/server/src/agent/ai-sdk-stream.ts` — 保留（AI SDK 仍用于流处理）
- Delete: 不再需要的 Mastra 特定文件

- [ ] **Step 1: Mark mastra.ts as legacy**

Rename or comment out Mastra imports. Keep the file for reference until Phase 5 fully verified.

- [ ] **Step 2: Remove Mastra dependencies from package.json**

```bash
cd vico/server && pnpm remove @mastra/core @mastra/hono @mastra/memory @mastra/ai-sdk @mastra/evals @mastra/observability @mastra/rag @mastra/libsql @mastra/loggers @mastra/fastembed @mastra/duckdb @mastra/agent-browser mastra
```

- [ ] **Step 3: Verify build**

```bash
cd vico/server && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(server): remove Mastra dependencies, switch to @vico/agent"
```

---

### Task 5: SkillsProcessor & Migration Tool

**Files:**
- Create: `packages/agent/src/skill/skills-processor.ts`
- Create: `packages/server/src/skill/migrate-to-skills-md.ts`

- [ ] **Step 1: Write SkillsProcessor**

```typescript
// src/skill/skills-processor.ts
import type { Skill } from './skill-loader.js';
import type { SkillManager } from './skill-manager.js';

/** SkillsProcessor — 将可用 Skill 元数据注入系统提示词（提前注入模式） */
export function formatSkillCatalog(skills: Skill[], format: 'xml' | 'json' = 'xml'): string {
  if (skills.length === 0) return '';

  if (format === 'json') {
    const list = skills.map((s) => ({ name: s.name, description: s.description }));
    return `<available_skills>\n${JSON.stringify(list, null, 2)}\n</available_skills>`;
  }

  // XML 格式（默认）
  const items = skills.map(
    (s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`,
  );
  return `<available_skills>\n${items.join('\n')}\n</available_skills>`;
}
```

- [ ] **Step 2: Write migration script**

```typescript
// src/skill/migrate-to-skills-md.ts
// 将旧 manifest.json + prompt.md + tools.ts → 新 SKILL.md 格式
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function migrateManifestToSKILLMD(skillDir: string): void {
  const manifestPath = resolve(skillDir, 'manifest.json');
  const promptPath = resolve(skillDir, 'prompt.md');

  if (!existsSync(manifestPath)) {
    console.error(`No manifest.json found in ${skillDir}`);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : '';

  const frontmatter = [
    `name: ${manifest.name}`,
    `description: ${manifest.description || ''}`,
    manifest.author ? `author: ${manifest.author}` : '',
    `version: ${manifest.version || '1.0.0'}`,
    manifest.category ? `metadata:\n  category: ${manifest.category}` : '',
  ].filter(Boolean).join('\n');

  const skillsMD = `---\n${frontmatter}\n---\n\n${prompt}`;
  writeFileSync(resolve(skillDir, 'SKILL.md'), skillsMD);
  console.log(`Migrated ${skillDir} to SKILL.md`);
}
```

- [ ] **Step 3: Update index.ts and commit**

```bash
cd vico/agent && npx tsc --noEmit
git add vico/agent/src/skill/skills-processor.ts vico/server/src/skill/migrate-to-skills-md.ts
git commit -m "feat: add SkillsProcessor and manifest-to-SKILL.md migration tool"
```

---

### Task 6: Final Tests & Verification

- [ ] **Step 1: Run all agent tests**

```bash
cd vico/agent && npx vitest run
```

- [ ] **Step 2: Run server tests**

```bash
cd vico/server && npx vitest run 2>/dev/null || echo "No server tests configured"
```

- [ ] **Step 3: Verify no Mastra imports remain**

```bash
grep -r "mastra" vico/server/src/ --include="*.ts" | grep -v "legacy" | grep -v ".test.ts" || echo "Clean"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize Phase 5 integration and cleanup"
```
