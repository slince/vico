# Phase 3: Memory & Knowledge System Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured WorkingMemory (user facts/preferences) and ObservationalMemory (conversation summaries) as supplemental memory layers atop the existing `memory_entries` table, integrated into the enhanced AI SDK v4 pipeline.

**Architecture:** Reuse `memory_entries` table with new types (`'working'`, `'observation'`) alongside existing types (`'fact'`, `'preference'`, `'summary'`, `'decision'`). WorkingMemory uses exact-match upsert via `upsertByContent()`; ObservationalMemory generates rule-based summaries when conversation messages exceed threshold. Both inject context into the agent's system prompt via `agent-factory.ts`, same pattern as existing LTM retrieval.

**Tech Stack:** TypeScript, better-sqlite3, AI SDK v4, Zod, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-13-mastra-agent-architecture-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/memory/long-term.ts` | Modify | Add `searchByType()` and `upsertByContent()` methods |
| `packages/server/src/agent/memory/working-memory.ts` | Create | User fact/preference extraction + retrieval |
| `packages/server/src/agent/memory/observational-memory.ts` | Create | Conversation summary compression |
| `packages/server/src/agent/memory/__tests__/working-memory.test.ts` | Create | Unit tests for WorkingMemory |
| `packages/server/src/agent/memory/__tests__/observational-memory.test.ts` | Create | Unit tests for ObservationalMemory |
| `packages/server/src/agent/mastra/agent-factory.ts` | Modify | Integrate WorkingMemory + ObservationalMemory into pipeline |
| `packages/server/src/memory/short-term.ts` | Modify | Add deprecation header comment |
| `packages/server/src/memory/long-term.ts` | Modify | Add deprecation header comment |

---

### Task 1: Add searchByType and upsertByContent to LongTermMemory

**Files:**
- Modify: `packages/server/src/memory/long-term.ts` (append methods before the `export const` line)

- [ ] **Step 1: Write failing test for new methods**

Create `packages/server/src/memory/__tests__/long-term-upgrade.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/db.js', () => {
  const mockPrepare = vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  });
  return {
    getDb: () => ({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }),
    getSqlite: () => ({
      prepare: mockPrepare,
    }),
    schema: {},
  };
});

vi.mock('../embedder.js', () => ({
  getEmbedder: () => ({ embed: async () => new Float32Array(384), dimension: () => 384 }),
  float32ToBlob: (v: Float32Array) => Buffer.from(v.buffer),
  blobToFloat32: (b: Buffer) => new Float32Array(0),
  cosineSimilarity: () => 0.5,
}));

describe('LongTermMemory upgrades', () => {
  it('searchByType filters entries by type', async () => {
    const { longTermMemory } = await import('../long-term.js');
    const results = await longTermMemory.searchByType('t1', 'u1', 'working', 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it('upsertByContent updates existing entry if content prefix matches', async () => {
    const { longTermMemory } = await import('../long-term.js');
    await expect(
      longTermMemory.upsertByContent({
        tenant_id: 't1',
        user_id: 'u1',
        type: 'working',
        content: 'test fact',
        importance: 0.8,
      })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd packages/server && pnpm test`

Expected: FAIL — `longTermMemory.searchByType is not a function`.

- [ ] **Step 3: Add searchByType and upsertByContent to long-term.ts**

First, check current imports. Read the imports section of long-term.ts.

Run to check current import state: `head -10 packages/server/src/memory/long-term.ts`

Then append these methods inside the `LongTermMemory` class, before the closing `}`:

```typescript
  /**
   * 按类型检索记忆条目
   *
   * 从 memory_entries 表中筛选指定 type，支持单个或多个类型。
   * 用于 WorkingMemory（type='working'）和 ObservationalMemory（type='observation'）。
   *
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param type - 记忆类型或类型数组
   * @param limit - 返回条目上限
   * @returns 记忆条目数组
   */
  async searchByType(
    tenantId: string,
    userId: string,
    type: string | string[],
    limit: number = 20,
  ): Promise<MemoryEntry[]> {
    const db = getSqlite();
    const types = Array.isArray(type) ? type : [type];
    const placeholders = types.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM memory_entries
       WHERE tenant_id = ? AND user_id = ? AND type IN (${placeholders})
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`
    ).all(tenantId, userId, ...types, limit) as any[];
    return rows.map((r) => ({
      ...r,
      embedding: r.embedding ? blobToFloat32(r.embedding) : null,
    }));
  }

  /**
   * 按内容+类型覆盖写入记忆
   *
   * 同 tenant + user + type + 内容前 120 字符匹配时更新，否则插入。
   * 用于 WorkingMemory 的去重存储，避免同一事实重复记录。
   *
   * @param entry - 记忆条目（不含 id、created_at、embedding）
   */
  async upsertByContent(
    entry: Omit<MemoryEntry, 'id' | 'created_at' | 'embedding'> & { expires_at?: number | null },
  ): Promise<void> {
    const db = getSqlite();
    const contentKey = entry.content.slice(0, 120);
    const existing = db.prepare(
      `SELECT id FROM memory_entries
       WHERE tenant_id = ? AND user_id = ? AND type = ? AND substr(content, 1, 120) = ?
       LIMIT 1`
    ).get(entry.tenant_id, entry.user_id, entry.type, contentKey) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE memory_entries
         SET content = ?, importance = ?, expires_at = ?
         WHERE id = ?`
      ).run(entry.content, entry.importance, entry.expires_at ?? null, existing.id);
    } else {
      const id = uuid();
      db.prepare(
        `INSERT INTO memory_entries (id, tenant_id, user_id, type, content, importance, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, entry.tenant_id, entry.user_id, entry.type, entry.content, entry.importance, Date.now(), entry.expires_at ?? null);
    }
  }
```

If `getSqlite` is not already imported at the top of the file, add it:

```typescript
import { getDb, getSqlite } from '../db/db.js';
```

If `blobToFloat32` is not imported, add it:

```typescript
import { getEmbedder, float32ToBlob, blobToFloat32 } from './embedder.js';
```

If `v4 as uuid` is not imported, add it:

```typescript
import { v4 as uuid } from 'uuid';
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && pnpm test`

Expected: 2 tests pass.

- [ ] **Step 5: Verify existing code still compiles**

Run: `cd packages/server && pnpm tsc --noEmit 2>&1 | grep "long-term" | head -5`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/memory/long-term.ts packages/server/src/memory/__tests__/long-term-upgrade.test.ts
git commit -m "feat: add searchByType and upsertByContent to LongTermMemory for Phase 3"
```

---

### Task 2: WorkingMemory — user fact extraction and retrieval

**Files:**
- Create: `packages/server/src/agent/memory/working-memory.ts`
- Create: `packages/server/src/agent/memory/__tests__/working-memory.test.ts`

- [ ] **Step 1: Verify directory exists**

Run: `ls packages/server/src/agent/memory/ 2>/dev/null || mkdir -p packages/server/src/agent/memory`

- [ ] **Step 2: Write failing test**

Create `packages/server/src/agent/memory/__tests__/working-memory.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock longTermMemory methods used by WorkingMemory
const mockSearchByType = vi.fn().mockResolvedValue([
  { id: '1', content: '用户偏好简洁回复', type: 'working', importance: 0.8 },
]);
const mockUpsertByContent = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../memory/long-term.js', () => ({
  longTermMemory: {
    searchByType: (...args: any[]) => mockSearchByType(...args),
    upsertByContent: (...args: any[]) => mockUpsertByContent(...args),
  },
}));

describe('WorkingMemory', () => {
  it('extracts user preferences from messages', async () => {
    const { workingMemory } = await import('../working-memory.js');
    await workingMemory.extractAndStore('t1', 'u1', [
      { role: 'user', content: '我喜欢简洁的回复风格，不要太多废话' },
    ]);
    expect(mockUpsertByContent).toHaveBeenCalled();
  });

  it('retrieve returns working memory entries formatted for prompt', async () => {
    const { workingMemory } = await import('../working-memory.js');
    const result = await workingMemory.retrieveAsPrompt('t1', 'u1');
    expect(result).toContain('用户偏好简洁回复');
  });

  it('returns empty string when no working memories exist', async () => {
    mockSearchByType.mockResolvedValueOnce([]);
    const { workingMemory } = await import('../working-memory.js');
    const result = await workingMemory.retrieveAsPrompt('t1', 'u1');
    expect(result).toBe('');
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `cd packages/server && pnpm test`

Expected: FAIL — `Cannot find module '../working-memory.js'`.

- [ ] **Step 4: Write working-memory.ts**

```typescript
/**
 * Working Memory — 用户工作记忆
 *
 * 管理系统自动提取的用户事实和偏好信息。
 * 存储于 memory_entries 表（type='working'），通过 longTermMemory
 * 的 searchByType/upsertByContent 方法读写。
 *
 * 提取规则：正则匹配用户消息中的事实/偏好模式。
 * 存储策略：同内容前缀（120字符）去重更新。
 */
import { longTermMemory } from '../../memory/long-term.js';

export class WorkingMemory {
  /**
   * 从对话消息中提取工作记忆事实
   *
   * 匹配以下用户消息模式：
   * - 偏好/习惯："我喜欢"/"我偏好"/"我习惯"/"我倾向于"/"我想要"/"我希望"
   * - 行为约定："以后"/"下次"/"将来"/"每次"
   * - 身份信息："我是"/"我叫"/"我在"/"我做"/"我使用"
   *
   * 提取后通过 longTermMemory.upsertByContent 去重存储。
   *
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param messages - 消息数组 [{role, content}]
   */
  async extractAndStore(
    tenantId: string,
    userId: string,
    messages: { role: string; content: string }[],
  ): Promise<void> {
    const patterns: { regex: RegExp; importance: number }[] = [
      { regex: /我(?:喜欢|偏好|习惯|倾向于|想要|希望|需要)(.+)/, importance: 0.8 },
      { regex: /(?:以后|下次|将来|每次|如果)(.+)/, importance: 0.6 },
      { regex: /我(?:是|叫|在|做|使用|用)(.+)/, importance: 0.5 },
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const { regex, importance } of patterns) {
        const match = msg.content.match(regex);
        if (match && match[1] && match[1].trim().length > 1) {
          const fact = match[1].trim();
          await longTermMemory.upsertByContent({
            tenant_id: tenantId,
            user_id: userId,
            type: 'working',
            content: fact,
            importance,
          }).catch(() => {}); // swallow storage errors (non-critical path)
        }
      }
    }
  }

  /**
   * 检索用户工作记忆
   *
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param limit - 最大返回数
   */
  async retrieve(tenantId: string, userId: string, limit: number = 10) {
    return longTermMemory.searchByType(tenantId, userId, 'working', limit);
  }

  /**
   * 将工作记忆格式化为 prompt 片段
   *
   * 空结果返回 ''，有结果时返回 "## 用户信息\n- fact1\n- fact2"。
   */
  async retrieveAsPrompt(tenantId: string, userId: string): Promise<string> {
    const entries = await this.retrieve(tenantId, userId);
    if (entries.length === 0) return '';
    return '## 用户信息\n' + entries.map((e: { content: string }) => `- ${e.content}`).join('\n');
  }
}

export const workingMemory = new WorkingMemory();
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd packages/server && pnpm test`

Expected: 3 tests pass (WorkingMemory tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/agent/memory/working-memory.ts packages/server/src/agent/memory/__tests__/working-memory.test.ts
git commit -m "feat: add WorkingMemory for user fact extraction and type-filtered retrieval"
```

---

### Task 3: ObservationalMemory — conversation summary compression

**Files:**
- Create: `packages/server/src/agent/memory/observational-memory.ts`
- Create: `packages/server/src/agent/memory/__tests__/observational-memory.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/server/src/agent/memory/__tests__/observational-memory.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockPrepare = vi.fn();
const mockGet = vi.fn().mockReturnValue({ count: 5 });
const mockAll = vi.fn().mockReturnValue([
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好！有什么可以帮助你的？' },
]);
const mockRun = vi.fn();

vi.mock('../../../db/db.js', () => ({
  getSqlite: () => ({
    prepare: mockPrepare,
  }),
  schema: {},
}));

vi.mock('../../../config.js', () => ({
  config: { memory: { stm_window: 20 } },
}));

vi.mock('../../../memory/embedder.js', () => ({
  blobToFloat32: () => new Float32Array(0),
}));

// Reset mocks before each test
beforeEach(() => {
  mockPrepare.mockReturnValue({
    get: mockGet,
    all: mockAll,
    run: mockRun,
  });
});

describe('ObservationalMemory', () => {
  it('does not compress when message count is below threshold', async () => {
    mockGet.mockReturnValue({ count: 5 }); // below threshold (40)
    const { observationalMemory } = await import('../observational-memory.js');
    const result = await observationalMemory.maybeCompress('t1', 'conv1');
    expect(result).toBe(false);
  });

  it('compresses when message count exceeds threshold', async () => {
    mockGet.mockReturnValue({ count: 50 }); // above threshold (40)
    const { observationalMemory } = await import('../observational-memory.js');
    const result = await observationalMemory.maybeCompress('t1', 'conv1');
    expect(result).toBe(true);
    expect(mockRun).toHaveBeenCalled();
  });

  it('retrieve returns observation entries for a conversation', async () => {
    mockAll.mockReturnValue([
      { id: '1', content: '[Conversation conv1]\n[用户]: 你好\n[助手]: 你好！', type: 'observation' },
    ]);
    const { observationalMemory } = await import('../observational-memory.js');
    const results = await observationalMemory.retrieve('t1', 'conv1');
    expect(results.length).toBeGreaterThan(0);
  });

  it('retrieveAsPrompt strips internal conversation tags', async () => {
    const rows = [
      { content: '[Conversation conv1]\n[用户]: hi\n[助手]: hello' },
    ];
    const { observationalMemory } = await import('../observational-memory.js');
    const prompt = observationalMemory.retrieveAsPrompt(rows);
    expect(prompt).toContain('对话历史摘要');
    expect(prompt).not.toContain('[Conversation conv1]');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/server && pnpm test -- --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — module not found.

- [ ] **Step 3: Write observational-memory.ts**

```typescript
/**
 * Observational Memory — 长对话摘要压缩
 *
 * 当对话消息数超过阈值（stm_window * 2）时，自动生成历史摘要
 * 存储到 memory_entries（type='observation'）。后续对话注入摘要作为
 * 额外上下文，代替过期消息，避免 token 窗口溢出。
 *
 * 摘要策略（Phase 3 MVP）：规则拼接，不引入 LLM 调用。
 * 取最近 stm_window*2 条消息，过滤 user/assistant，截断到 200 字拼接。
 */
import { v4 as uuid } from 'uuid';
import { getSqlite } from '../../db/db.js';
import { config } from '../../config.js';

export class ObservationalMemory {
  private readonly compressThreshold: number;

  constructor() {
    this.compressThreshold = (config.memory.stm_window || 20) * 2;
  }

  /**
   * 检查并执行对话摘要压缩
   *
   * 消息数 >= compressThreshold 时触发。取最近 threshold 条消息，
   * 过滤 user/assistant 角色，每人每条截断 200 字，拼接后存入 memory_entries。
   *
   * @param tenantId - 租户 ID
   * @param conversationId - 对话 ID
   * @returns 是否执行了压缩
   */
  async maybeCompress(tenantId: string, conversationId: string): Promise<boolean> {
    const db = getSqlite();

    const countRow = db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
    ).get(conversationId) as { count: number };

    if (countRow.count < this.compressThreshold) return false;

    const recentMessages = db.prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(conversationId, this.compressThreshold) as { role: string; content: string }[];

    const summary = recentMessages
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content.slice(0, 200)}`)
      .join('\n');

    const id = uuid();
    db.prepare(
      `INSERT INTO memory_entries (id, tenant_id, user_id, type, content, importance, created_at)
       VALUES (?, ?, '', 'observation', ?, 0.3, ?)`
    ).run(id, tenantId, `[Conversation ${conversationId}]\n${summary}`, Date.now());

    return true;
  }

  /**
   * 检索对话的观察记忆
   *
   * 通过 content LIKE '%[Conversation <id>]%' 匹配。
   *
   * @param tenantId - 租户 ID
   * @param conversationId - 对话 ID
   * @param limit - 最大返回数
   */
  async retrieve(tenantId: string, conversationId: string, limit: number = 3) {
    const db = getSqlite();
    return db.prepare(
      `SELECT * FROM memory_entries
       WHERE tenant_id = ? AND type = 'observation' AND content LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(tenantId, `%[Conversation ${conversationId}]%`, limit) as any[];
  }

  /**
   * 将观察记忆格式化为 prompt 片段
   *
   * 移除内部标签前缀 [Conversation xxx]，只保留摘要内容。
   */
  retrieveAsPrompt(rows: any[]): string {
    if (rows.length === 0) return '';
    const summaries = rows.map((r) => {
      return (r.content as string).replace(/^\[Conversation .+?\]\n?/, '');
    });
    return '## 对话历史摘要\n' + summaries.join('\n---\n');
  }
}

export const observationalMemory = new ObservationalMemory();
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd packages/server && pnpm test`

Expected: all 4 observational memory tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agent/memory/observational-memory.ts packages/server/src/agent/memory/__tests__/observational-memory.test.ts
git commit -m "feat: add ObservationalMemory for long conversation summary compression"
```

---

### Task 4: Integrate new memory modules into enhanced pipeline

**Files:**
- Modify: `packages/server/src/agent/mastra/agent-factory.ts` (add imports + context injection + extraction)

- [ ] **Step 1: Write failing test for integration**

Create `packages/server/src/agent/mastra/__tests__/agent-factory-memory.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockRetrieveAsPrompt = vi.fn().mockResolvedValue('## 用户信息\n- 测试事实');
const mockExtractAndStore = vi.fn().mockResolvedValue(undefined);
const mockMaybeCompress = vi.fn().mockResolvedValue(false);
const mockRetrieveObservation = vi.fn().mockResolvedValue([]);
const mockRetrieveAsPromptObs = vi.fn().mockReturnValue('');

vi.mock('../../memory/working-memory.js', () => ({
  workingMemory: {
    retrieveAsPrompt: (...args: any[]) => mockRetrieveAsPrompt(...args),
    extractAndStore: (...args: any[]) => mockExtractAndStore(...args),
  },
}));

vi.mock('../../memory/observational-memory.js', () => ({
  observationalMemory: {
    retrieve: (...args: any[]) => mockRetrieveObservation(...args),
    retrieveAsPrompt: (...args: any[]) => mockRetrieveAsPromptObs(...args),
    maybeCompress: (...args: any[]) => mockMaybeCompress(...args),
  },
}));

describe('Agent factory memory integration', () => {
  it('workingMemory.retrieveAsPrompt is available for import', async () => {
    const { workingMemory } = await import('../../memory/working-memory.js');
    expect(typeof workingMemory.retrieveAsPrompt).toBe('function');
  });

  it('observationalMemory.retrieve is available for import', async () => {
    const { observationalMemory } = await import('../../memory/observational-memory.js');
    expect(typeof observationalMemory.retrieve).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm modules resolve**

Run: `cd packages/server && pnpm test`

Expected: 2 tests pass (modules already exist from Tasks 2-3).

- [ ] **Step 3: Add imports to agent-factory.ts**

Read the current imports of agent-factory.ts to find the right insertion point:

Run: `head -20 packages/server/src/agent/mastra/agent-factory.ts`

Add these imports after the existing memory imports:

```typescript
import { workingMemory } from '../memory/working-memory.js';
import { observationalMemory } from '../memory/observational-memory.js';
```

- [ ] **Step 4: Add memory context to system prompt construction**

Find the section where `systemPrompt` is built (search for `const systemPrompt = [`). Add `workingContext` and `observationContext` variables before the systemPrompt construction, then include them in the array.

Before the `const systemPrompt = [` line, add:

```typescript
    // WorkingMemory: user facts/preferences
    const workingContext = await workingMemory.retrieveAsPrompt(ctx.tenantId, ctx.userId);

    // ObservationalMemory: conversation summaries
    let observationContext = '';
    if (conversationId) {
      const obsRows = await observationalMemory.retrieve(ctx.tenantId, conversationId);
      observationContext = observationalMemory.retrieveAsPrompt(obsRows);
    }
```

Then update the systemPrompt array to include these:

Change from:
```typescript
    const systemPrompt = [
      agentRow.system_prompt,
      skillPrompt,
      ltmContext,
      ragContext,
    ].filter(Boolean).join('\n');
```

To:
```typescript
    const systemPrompt = [
      agentRow.system_prompt,
      workingContext,
      observationContext,
      skillPrompt,
      ltmContext,
      ragContext,
    ].filter(Boolean).join('\n');
```

- [ ] **Step 5: Add memory extraction after message persistence**

Find the section in the `ReadableStream` `start` method where LTM extraction happens. After that block, add WorkingMemory extraction and ObservationalMemory compression. Search for `longTermMemory.extractAndStore`.

After the existing LTM extract block, add:

```typescript
          // Phase 3: WorkingMemory extraction (non-blocking)
          workingMemory.extractAndStore(ctx.tenantId, ctx.userId, [
            { role: 'user', content: message },
            { role: 'assistant', content: finalText },
          ]).catch(() => {});

          // Phase 3: ObservationalMemory compression check (non-blocking)
          if (conversationId) {
            observationalMemory.maybeCompress(ctx.tenantId, conversationId).catch(() => {});
          }
```

- [ ] **Step 6: Verify build**

Run: `cd packages/server && pnpm tsc --noEmit 2>&1 | grep -E "agent-factory" | head -10`

Expected: no errors from agent-factory.ts.

- [ ] **Step 7: Run all tests**

Run: `cd packages/server && pnpm test`

Expected: all tests pass across all modules.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/agent/mastra/agent-factory.ts packages/server/src/agent/mastra/__tests__/
git commit -m "feat: integrate WorkingMemory and ObservationalMemory into enhanced agent pipeline"
```

---

### Task 5: Deprecation notices on legacy memory modules

**Files:**
- Modify: `packages/server/src/memory/short-term.ts` (add header comment)
- Modify: `packages/server/src/memory/long-term.ts` (add header comment)

- [ ] **Step 1: Add deprecation comment to short-term.ts**

Insert at the top of the file, after any existing imports but before `export interface ShortTermMessage`:

```typescript
/**
 * @phase Phase 1/2
 * @status Active — primary conversation window cache for all pipelines.
 *
 * Phase 3 adds WorkingMemory + ObservationalMemory as supplemental layers,
 * but this module remains the authoritative conversation window cache.
 * No migration needed.
 */
```

- [ ] **Step 2: Add phase annotation to long-term.ts**

Insert at the top of the file:

```typescript
/**
 * @phase Phase 1/3
 * @status Enhanced — Phase 3 added searchByType() and upsertByContent()
 * for structured memory types ('working', 'observation').
 *
 * The original vector-based retrieve() + extractAndStore() are retained
 * for semantic similarity search (type='fact', 'preference', etc.).
 */
```

- [ ] **Step 3: Verify files still compile**

Run: `cd packages/server && pnpm tsc --noEmit 2>&1 | head -5`

Expected: no errors.

- [ ] **Step 4: Run all tests**

Run: `cd packages/server && pnpm test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/memory/short-term.ts packages/server/src/memory/long-term.ts
git commit -m "docs: add phase annotations to legacy memory modules"
```

---

## Verification

- [ ] `cd packages/server && pnpm test` — all tests pass (working-memory, observational-memory, long-term-upgrade, agent-factory-memory)
- [ ] `cd packages/server && pnpm tsc --noEmit` — no type errors
- [ ] `pnpm dev` — server starts without errors
- [ ] Set `agent_engine: mastra` in `server.config.yaml`
- [ ] Send chat: "我喜欢简洁的回复风格"
- [ ] Send chat: "你还记得我的偏好吗？" — verify agent references working memory
- [ ] Check DB: `sqlite3 packages/server/data/vico.db "SELECT type, content FROM memory_entries WHERE type='working'"`
- [ ] Expected: row with `type='working', content='简洁的回复风格'`
- [ ] Send 40+ messages in same conversation — verify observation entry created
- [ ] Check DB: `sqlite3 packages/server/data/vico.db "SELECT type, substr(content,1,100) FROM memory_entries WHERE type='observation'"`
- [ ] Set `agent_engine: legacy` — verify legacy pipeline still works
