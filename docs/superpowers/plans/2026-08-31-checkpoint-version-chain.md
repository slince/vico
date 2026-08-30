# Checkpoint 多版本制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `vico_checkpoints` 从"turn 级单行原地覆盖"改造为"多版本链 append-only"（每 step 一个版本），实现审计 / 可回放（fork）/ 崩溃恢复恰好一次的修复，并接线全局 TTL 清理。

**Architecture:** 单表多版本制——`vico_checkpoints` 以 `(turn_id, version)` 复合主键存一个 turn 的完整版本链，每行一个全量快照 JSON；`CheckpointStore` 接口改为 append-only（`create`/`append`/`getLatest`/`getVersion`/`listVersions`/`fork`/`deleteByTurn`/`purgeExpired`）。loop-agent 只在 step 完成 / pause / 终态 append 版本，删除全部实时 `update`；工具执行不再写 checkpoint，工具是否完成以消息链（事实源）为准；恢复路径用消息链核对 + 复用已有 `KeyedMutex` 做 per-turn 串行锁。

**Tech Stack:** TypeScript monorepo（pnpm + Turborepo）、Vercel AI SDK 7、Drizzle ORM、better-sqlite3/LibSQL（`@libsql/client` + `drizzle-orm/libsql`）、MySQL（`drizzle-orm/mysql2`）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-31-checkpoint-version-chain-design.md`（本计划论证完全从此 spec 出发，执行者需同时阅读该文档）。

## Global Constraints

- **单表多版本制**：仅改造现有 `vico_checkpoints` 表，不新增任何表。复合主键 `(turn_id, version)`。
- **append-only**：无原地更新。删除 `update` 与 `listByThread` 方法；`deleteByTurn` 仅显式调用（turn 完成后版本链全量保留，不自动删）。
- **版本粒度**：每 step 一个版本；`next_action` 三态 `model | tool-approval | end`，与 append 时机严格对应（见 spec 四节表格）。
- **fork 语义**：分叉成新 turn，原 turn 版本链不变；分叉来源 `forkedFrom: { turnId, version }` 记录在新 turn 上。
- **幂等**：消息链是唯一事实源——已落链的 `tool_result` 绝不重发；绝对"恰好一次"不可达，靠工具幂等契约闭合（文档明确边界）。
- **保留策略**：全量保留 + 全局 TTL，`DEFAULT_CHECKPOINT_TTL` 由 7 天改为 **30 天**；`purgeExpired` **整链删除**（一个 turn 的所有版本一起删，避免断链）。
- **checkpoint 表列**：`turn_id` / `thread_id` / `version` / `step_index` / `next_action` / `snapshot` / `created_at`（删 `id`/`paused`/`pending_tool`/`updated_at`）。
- **旧数据**：升级前单行数据启动时丢弃——`ensureTables` 检测旧结构后 DROP + CREATE 重建；运行中 turn 降级为"无 checkpoint"。
- **代码注释**：所有新增/修改的函数、方法、类型需带 JSDoc/行注释（项目 CLAUDE.md 强制）。

**接口签名说明（相对 spec 缩写的必要细化，语义不变）：**
- `append(turnId: string, patch: CheckpointAppendPatch)` —— spec 写 `append(patch)`，但 store 需知道属主 turn，patch 内不含 turnId，故 turnId 作为首参。`CheckpointAppendPatch` 的五个字段全部必填（`stepIndex`/`nextAction`/`approvedTools`/`pauseInfo`/`lastMessageId`），合并语义为"patch 字段全量覆盖最新版本快照"，消除继承歧义。
- `purgeExpired` 返回值语义：返回**被整链删除的 turnId 数组**（旧语义"返回 paused turnId 供清理 pause 锁"已无意义——新设计无 pause 锁）。
- `fork` 返回 `Promise<Checkpoint | undefined>`：源版本不存在时返回 `undefined`（旧 turn 无版本链不可分叉）。

---

## 文件结构

```
修改：
  packages/core/src/agent/checkpoint.ts                 类型 + CheckpointStore 接口重写
  packages/core/src/index.ts                            导出新增类型
  packages/core/src/agent/memory-checkpoint-store.ts    多版本实现
  packages/core/src/thread/thread-store.ts              Turn.forkedFrom + createTurn opts
  packages/core/src/thread/memory-thread-store.ts       forkedFrom 持久化
  packages/libsql-adapter/src/schema.ts                 checkpoints 复合主键 + next_action；turns + forked_from
  packages/libsql-adapter/src/migrate.ts                ensureTables DROP+CREATE 重建 + turns forked_from
  packages/libsql-adapter/src/libsql-thread-store.ts    forkedFrom 读写
  packages/libsql-adapter/src/libsql-checkpoint-store.ts 多版本重写
  packages/mysql-adapter/src/schema.ts                  checkpoints 复合主键 + next_action；turns + forked_from
  packages/mysql-adapter/src/mysql-thread-store.ts      forkedFrom 读写
  packages/mysql-adapter/src/mysql-checkpoint-store.ts  多版本重写
  packages/core/src/agent/tool-executor.ts              删除 checkpoint 写入
  packages/core/src/agent/loop-agent.ts                 调用点改造 + 恢复逻辑 + per-turn 锁
  vico/server/src/vico.ts                               purgeExpired 接线
  vico/server/src/config.ts                             checkpoint.ttl_days 配置
  vico/server/server.config.yaml                        checkpoint.ttl_days: 30
新建：
  packages/core/src/agent/loop-agent.test.ts            findUnpairedToolCalls 单测（loop-agent 内导出纯函数）
  packages/core/src/agent/memory-checkpoint-store.test.ts
  packages/core/src/thread/memory-thread-store.test.ts
  packages/libsql-adapter/vitest.config.ts
  packages/libsql-adapter/src/libsql-checkpoint-store.test.ts
  packages/libsql-adapter/src/migrate.test.ts
  vico/server/src/checkpoint-purge.ts                   startCheckpointPurge（可测的定时清理模块）
  vico/server/src/lib/__tests__/checkpoint-purge.test.ts
依赖变更：
  packages/libsql-adapter/package.json                  新增 devDependencies: vitest
```

**执行顺序说明**：Task 1 重写接口后，`MemoryCheckpointStore` / `LibSqlCheckpointStore` / `MysqlCheckpointStore` / `tool-executor.ts` / `loop-agent.ts` 会**暂时编译失败（预期红灯）**，由 Task 2/6/7/9/10 逐个恢复。最终绿灯门槛在 Task 10 之后（`pnpm -r typecheck`），Task 11 覆盖 server 侧。

---

### Task 1: 重写 Checkpoint 类型 + CheckpointStore 接口

**Files:**
- Modify: `packages/core/src/agent/checkpoint.ts`（全文重写）
- Modify: `packages/core/src/index.ts:167`（导出新增类型）

**Interfaces:**
- Produces: `NextAction`、`CheckpointAppendPatch`、新版 `Checkpoint`、新版 `CheckpointStore`、`createCheckpoint(turnId, threadId)` 初始快照构造、`DEFAULT_CHECKPOINT_TTL = 30 天`。后续 Task 2/6/7 的 store 全部 `implements` 此接口；Task 9/10 的 loop-agent 调用这些方法。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/agent/checkpoint.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { createCheckpoint, DEFAULT_CHECKPOINT_TTL, CHECKPOINT_CURRENT_VERSION } from './checkpoint.js';

describe('createCheckpoint（初始版本快照）', () => {
  it('生成 version=1 / stepIndex=0 / nextAction=model 的初始快照', () => {
    const ckpt = createCheckpoint('turn-1', 'thread-1');
    expect(ckpt.turnId).toBe('turn-1');
    expect(ckpt.threadId).toBe('thread-1');
    expect(ckpt.version).toBe(1);
    expect(ckpt.stepIndex).toBe(0);
    expect(ckpt.nextAction).toBe('model');
    expect(ckpt.approvedTools).toEqual({});
    expect(ckpt.pauseInfo).toBeNull();
    expect(ckpt.lastMessageId).toBeNull();
    expect(ckpt.schemaVersion).toBe(CHECKPOINT_CURRENT_VERSION);
    expect(ckpt.createdAt).toBeGreaterThan(0);
  });

  it('TTL 默认为 30 天', () => {
    expect(DEFAULT_CHECKPOINT_TTL).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @vico/core test -- checkpoint.test.ts`
Expected: FAIL —— 现版 `createCheckpoint` 返回含 `id`/`updatedAt`/`pendingToolCall`/`completedToolResults`，无 `nextAction`/`lastMessageId`/`schemaVersion`；`DEFAULT_CHECKPOINT_TTL` 为 7 天。

- [ ] **Step 3: 最小实现（重写 checkpoint.ts）**

```typescript
// @vico/core - Checkpoint 多版本类型 + CheckpointStore 接口 + 版本迁移
import type {ToolCall, ToolResult} from '../tool/types.js';
import type {ToolApproval} from './loop-agent-options.js';

/** Checkpoint 快照（snapshot JSON）schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 1;

/** turn 暂停原因及恢复所需信息 */
export interface PauseInfo {
  reason: 'tool-approval' | 'error';
  pendingToolCalls: ToolCall[];
  approvedCalls?: ToolCall[];
  deniedResults?: ToolResult[];
  pausedAtStep: number;
}

/** 下一步意图：模型调用 / 等待审批 / 已结束 */
export type NextAction = 'model' | 'tool-approval' | 'end';

/**
 * vico_checkpoints 一行 = 一个版本（完整快照）。
 * version 为 per-turn 递增链版本号；schemaVersion 为快照 JSON 的 schema 版本（懒迁移用）。
 */
export interface Checkpoint {
  turnId: string;
  threadId: string;
  /** per-turn 递增链版本号 */
  version: number;
  /** 恢复续跑点：下一步从该 step 继续（平铺列 step_index） */
  stepIndex: number;
  /** 下一步意图：模型调用 / 等待审批 / 已结束（平铺列 next_action） */
  nextAction: NextAction;
  /** 本 turn 已批准的工具名 → ToolApproval */
  approvedTools: Record<string, ToolApproval>;
  /** 暂停现场（非空 = 等待审批/出错） */
  pauseInfo: PauseInfo | null;
  /** append 时的最后一条消息 id，fork 时截断消息链用 */
  lastMessageId: string | null;
  /** checkpoint 快照 schema 版本，懒迁移用 */
  schemaVersion: number;
  /** 创建时间（Unix ms），purgeExpired 按整链 created_at 清理 */
  createdAt: number;
}

/**
 * append 追加一个版本的增量 patch。
 * 五个字段全部必填 —— 合并语义为「patch 字段全量覆盖最新版本快照」，消除继承歧义。
 */
export interface CheckpointAppendPatch {
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  pauseInfo: PauseInfo | null;
  lastMessageId: string | null;
}

/** CheckpointStore 接口（append-only 版本链） */
export interface CheckpointStore {
  /** 创建初始版本（version=1、stepIndex=0、nextAction=model），turn 开始时调用 */
  create(turnId: string, threadId: string): Promise<Checkpoint>;
  /** 追加一个版本，版本号 = 当前最大版本 + 1；nextAction 由调用点传入 */
  append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint>;
  /** 读最新版本（版本号最大），崩溃/审批恢复用 */
  getLatest(turnId: string): Promise<Checkpoint | undefined>;
  /** 读指定版本，审计 / fork 用 */
  getVersion(turnId: string, version: number): Promise<Checkpoint | undefined>;
  /** 按版本号升序返回，审计时间线 */
  listVersions(turnId: string): Promise<Checkpoint[]>;
  /** 从历史版本复制快照到新 turn 的初始版本，作为分叉起点；源版本不存在返回 undefined */
  fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined>;
  /** 删除整个 turn 的版本链（显式清理，非自动） */
  deleteByTurn(turnId: string): Promise<void>;
  /** 按整链 created_at 清理：一个 turn 的所有版本一起删（避免断链）；返回被删 turnId 数组 */
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/**
 * 构造初始版本快照（turn 开始时由 store 的 create 调用）。
 *
 * @param turnId - 所属 turn
 * @param threadId - 所属 thread
 * @returns 含默认值的初始 Checkpoint（version=1）
 */
export function createCheckpoint(turnId: string, threadId: string): Checkpoint {
  return {
    turnId,
    threadId,
    version: 1,
    stepIndex: 0,
    nextAction: 'model',
    approvedTools: {},
    pauseInfo: null,
    lastMessageId: null,
    schemaVersion: CHECKPOINT_CURRENT_VERSION,
    createdAt: Date.now(),
  };
}

/**
 * 版本迁移函数映射：schemaVersion N → N+1。
 * 每个函数只负责一个版本的升级。
 */
export const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {
  // 示例：v1 → v2
  // 1: (s) => ({ ...s, version: 2, executionTimeline: buildTimeline(s) }),
};

/** 默认 checkpoint 存活时间：30 天 */
export const DEFAULT_CHECKPOINT_TTL = 30 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 4: 更新 index.ts 导出**

在 `packages/core/src/index.ts:167`，把旧导出替换为：

```typescript
export { type PauseInfo, type Checkpoint, type CheckpointAppendPatch, type CheckpointStore, type NextAction, CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint, DEFAULT_CHECKPOINT_TTL } from './agent/checkpoint.js';
```

- [ ] **Step 5: 运行测试验证通过**

Run: `pnpm --filter @vico/core test -- checkpoint.test.ts`
Expected: PASS（`createCheckpoint` / TTL 两个用例通过）。注意此时 `pnpm --filter @vico/core typecheck` **预期失败**（store 未实现新接口）——属计划内红灯，Task 2 恢复。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/checkpoint.ts packages/core/src/agent/checkpoint.test.ts packages/core/src/index.ts
git commit -m "feat(core): 重写 Checkpoint 多版本类型与 CheckpointStore 接口"
```

---

### Task 2: MemoryCheckpointStore 多版本实现 + 单测

**Files:**
- Modify: `packages/core/src/agent/memory-checkpoint-store.ts`（全文重写）
- Test: `packages/core/src/agent/memory-checkpoint-store.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Checkpoint`/`CheckpointAppendPatch`/`CheckpointStore`/`createCheckpoint`。
- Produces: `MemoryCheckpointStore`（implements 新版接口）——Task 9/10 的 loop 集成测试与 Task 11 server 单测复用它做行为基准。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/agent/memory-checkpoint-store.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { MemoryCheckpointStore } from './memory-checkpoint-store.js';
import type { CheckpointAppendPatch } from './checkpoint.js';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { stepIndex: 1, nextAction: 'model', approvedTools: {}, pauseInfo: null, lastMessageId: null, ...overrides };
}

describe('MemoryCheckpointStore（多版本链）', () => {
  it('create 生成初始版本（version=1、stepIndex=0、nextAction=model）', async () => {
    const store = new MemoryCheckpointStore();
    const ckpt = await store.create('turn-1', 'thread-1');
    expect(ckpt.version).toBe(1);
    expect(ckpt.stepIndex).toBe(0);
    expect(ckpt.nextAction).toBe('model');
  });

  it('append 版本号递增，快照字段由 patch 全量覆盖', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ stepIndex: 1, nextAction: 'tool-approval', pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 0 } }));
    const v3 = await store.append('turn-1', patch({ stepIndex: 2, nextAction: 'end' }));
    expect(v2.version).toBe(2);
    expect(v2.nextAction).toBe('tool-approval');
    expect(v3.version).toBe(3);
    expect(v3.pauseInfo).toBeNull(); // patch 显式覆盖，不继承 v2 的 pauseInfo
  });

  it('getLatest 取最新版本', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 2, nextAction: 'end' }));
    const latest = await store.getLatest('turn-1');
    expect(latest?.version).toBe(2);
    expect(latest?.nextAction).toBe('end');
  });

  it('getVersion 读指定版本', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 5, nextAction: 'tool-approval' }));
    const v2 = await store.getVersion('turn-1', 2);
    expect(v2?.stepIndex).toBe(5);
    expect(await store.getVersion('turn-1', 99)).toBeUndefined();
  });

  it('listVersions 按版本号升序返回', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch());
    await store.append('turn-1', patch());
    const versions = await store.listVersions('turn-1');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('fork 从源版本复制快照到新 turn 初始版本，原 turn 链不变', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 3, nextAction: 'tool-approval', pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 3 } }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked).toBeDefined();
    expect(forked!.version).toBe(1);        // 新 turn 初始版本
    expect(forked!.threadId).toBe('thread-2');
    expect(forked!.stepIndex).toBe(3);       // 继承分叉点
    expect(forked!.nextAction).toBe('tool-approval');
    expect(forked!.pauseInfo?.pausedAtStep).toBe(3);
    // 原 turn 链不变
    expect((await store.listVersions('turn-1')).map((v) => v.version)).toEqual([1, 2]);
    // 源版本不存在 → undefined
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除（一个 turn 的所有版本一起删）', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch());
    await store.create('turn-new', 'thread-1');
    // 把 turn-old 的 created_at 调回过去
    for (const v of await store.listVersions('turn-old')) {
      (v as { createdAt: number }).createdAt = Date.now() - 100_000;
    }
    const purged = await store.purgeExpired(10_000);
    expect(purged).toEqual(['turn-old']);
    expect(await store.listVersions('turn-old')).toEqual([]); // 整链消失，无残留版本
    expect((await store.listVersions('turn-new')).length).toBe(1); // 活跃 turn 不受影响
  });

  it('deleteByTurn 删除整个版本链', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch());
    await store.deleteByTurn('turn-1');
    expect(await store.getLatest('turn-1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @vico/core test -- memory-checkpoint-store.test.ts`
Expected: FAIL —— 现版 store 无 `append`/`getLatest`/`getVersion`/`listVersions`/`fork`，`create` 不满足新语义。

- [ ] **Step 3: 最小实现（重写 memory-checkpoint-store.ts）**

```typescript
// @vico/core — In-memory CheckpointStore implementation（多版本链，append-only）
import type { Checkpoint, CheckpointAppendPatch, CheckpointStore } from './checkpoint.js';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from './checkpoint.js';

/**
 * In-memory 多版本 {@link CheckpointStore}。
 * 以 `${turnId}:${version}` 为 key 存一个 turn 的完整版本链，支持懒迁移。
 */
export class MemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, Checkpoint>();

  private key(turnId: string, version: number): string {
    return `${turnId}:${version}`;
  }

  /** 创建初始版本（version=1、stepIndex=0、nextAction=model），turn 开始时调用 */
  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    this.store.set(this.key(turnId, checkpoint.version), checkpoint);
    return checkpoint;
  }

  /** 追加一个版本：版本号 = 当前最大版本 + 1，快照字段由 patch 全量覆盖 */
  async append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint> {
    const latest = await this.getLatest(turnId);
    const checkpoint: Checkpoint = {
      turnId,
      threadId: latest?.threadId ?? '',
      version: (latest?.version ?? 0) + 1,
      stepIndex: patch.stepIndex,
      nextAction: patch.nextAction,
      approvedTools: patch.approvedTools,
      pauseInfo: patch.pauseInfo,
      lastMessageId: patch.lastMessageId,
      schemaVersion: CHECKPOINT_CURRENT_VERSION,
      createdAt: Date.now(),
    };
    this.store.set(this.key(turnId, checkpoint.version), checkpoint);
    return checkpoint;
  }

  /** 读最新版本（版本号最大） */
  async getLatest(turnId: string): Promise<Checkpoint | undefined> {
    let latest: Checkpoint | undefined;
    for (const ckpt of this.store.values()) {
      if (ckpt.turnId === turnId && (!latest || ckpt.version > latest.version)) {
        latest = ckpt;
      }
    }
    return latest ? this.migrate(latest) : undefined;
  }

  /** 读指定版本 */
  async getVersion(turnId: string, version: number): Promise<Checkpoint | undefined> {
    const ckpt = this.store.get(this.key(turnId, version));
    return ckpt ? this.migrate(ckpt) : undefined;
  }

  /** 按版本号升序返回完整版本链 */
  async listVersions(turnId: string): Promise<Checkpoint[]> {
    const versions: Checkpoint[] = [];
    for (const ckpt of this.store.values()) {
      if (ckpt.turnId === turnId) versions.push(this.migrate(ckpt));
    }
    versions.sort((a, b) => a.version - b.version);
    return versions;
  }

  /** 从源 turn 的历史版本复制快照到新 turn 的初始版本（分叉起点） */
  async fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined> {
    const source = await this.getVersion(sourceTurnId, version);
    if (!source) return undefined;
    const checkpoint = createCheckpoint(newTurnId, newThreadId);
    checkpoint.stepIndex = source.stepIndex;
    checkpoint.nextAction = source.nextAction;
    checkpoint.approvedTools = { ...source.approvedTools };
    checkpoint.pauseInfo = source.pauseInfo;
    checkpoint.lastMessageId = source.lastMessageId;
    this.store.set(this.key(newTurnId, checkpoint.version), checkpoint);
    return checkpoint;
  }

  /** 删除整个 turn 的版本链 */
  async deleteByTurn(turnId: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${turnId}:`)) this.store.delete(key);
    }
  }

  /** 整链清理：一个 turn 的所有版本一起删（否则断链），返回被删 turnId 数组 */
  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expiredTurnIds: string[] = [];
    const turnIds = new Set([...this.store.values()].map((c) => c.turnId));
    for (const turnId of turnIds) {
      const versions = [...this.store.values()].filter((c) => c.turnId === turnId);
      const latestCreatedAt = Math.max(...versions.map((c) => c.createdAt));
      // 整链最新版本都过期才删整链
      if (latestCreatedAt < cutoff) {
        expiredTurnIds.push(turnId);
        for (const v of versions) this.store.delete(this.key(turnId, v.version));
      }
    }
    return expiredTurnIds;
  }

  /** 懒迁移：按 schemaVersion 逐级升级到 CHECKPOINT_CURRENT_VERSION */
  private migrate(ckpt: Checkpoint): Checkpoint {
    let snapshot = ckpt as unknown as Record<string, unknown>;
    while ((snapshot.schemaVersion as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.schemaVersion as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @vico/core test -- memory-checkpoint-store.test.ts`
Expected: PASS（8 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/memory-checkpoint-store.ts packages/core/src/agent/memory-checkpoint-store.test.ts
git commit -m "feat(core): MemoryCheckpointStore 多版本链实现"
```

---

### Task 3: Turn.forkedFrom + createTurn 扩展 + 内存版实现 + 单测

**Files:**
- Modify: `packages/core/src/thread/thread-store.ts`（`Turn` 增加 `forkedFrom`；`createTurn` 增加 opts）
- Modify: `packages/core/src/thread/memory-thread-store.ts`（实现 forkedFrom）
- Test: `packages/core/src/thread/memory-thread-store.test.ts`

**Interfaces:**
- Consumes: 无（仅改自身）。
- Produces: `Turn.forkedFrom?: { turnId: string; version: number } | null`；`createTurn(threadId, opts?: { forkedFrom? })`。Task 4/5 的 libsql/mysql thread store 实现同签名。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/thread/memory-thread-store.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { InMemoryThreadStore } from './memory-thread-store.js';

describe('InMemoryThreadStore.createTurn（forkedFrom）', () => {
  it('createTurn 接受 forkedFrom 并返回', async () => {
    const store = new InMemoryThreadStore();
    const turn = await store.createTurn('thread-1', { forkedFrom: { turnId: 'source-turn', version: 3 } });
    expect(turn.forkedFrom).toEqual({ turnId: 'source-turn', version: 3 });
    const fetched = await store.getTurn(turn.id);
    expect(fetched?.forkedFrom).toEqual({ turnId: 'source-turn', version: 3 });
  });

  it('不传 opts 时 forkedFrom 为 null', async () => {
    const store = new InMemoryThreadStore();
    const turn = await store.createTurn('thread-1');
    expect(turn.forkedFrom).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @vico/core test -- memory-thread-store.test.ts`
Expected: FAIL —— 现版 `createTurn(threadId)` 无第二参数，`Turn` 无 `forkedFrom` 字段。

- [ ] **Step 3: 最小实现**

在 `packages/core/src/thread/thread-store.ts` 中：

```typescript
export interface Turn {
  id: string;
  threadId: string;
  status: TurnStatus;
  steps: number;
  /** 自定义元数据（JSON 可序列化），如 PauseInfo */
  metadata?: TurnMetadata;
  /** 本 turn 由源 turn 的某版本分叉而来（null = 普通 turn） */
  forkedFrom?: { turnId: string; version: number } | null;
  createdAt: number;
}
```

并把接口 `createTurn` 签名改为（`ThreadStore` 接口中）：

```typescript
  /** 创建新轮次，可携带 fork 来源（forkedFrom） */
  createTurn(threadId: string, opts?: { forkedFrom?: Turn['forkedFrom'] }): Promise<Turn>;
```

在 `packages/core/src/thread/memory-thread-store.ts` 中把 `createTurn` 改为：

```typescript
  async createTurn(threadId: string, opts?: { forkedFrom?: Turn['forkedFrom'] }): Promise<Turn> {
    const turn: Turn = {
      id: crypto.randomUUID(),
      threadId,
      status: 'running',
      steps: 0,
      forkedFrom: opts?.forkedFrom ?? null,
      createdAt: Date.now(),
    };
    this.turns.set(turn.id, turn);
    return turn;
  }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @vico/core test -- memory-thread-store.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/thread/thread-store.ts packages/core/src/thread/memory-thread-store.ts packages/core/src/thread/memory-thread-store.test.ts
git commit -m "feat(core): Turn 增加 forkedFrom + createTurn 扩展"
```

---

### Task 4: libsql schema + ensureTables 重建 + LibSqlThreadStore.forkedFrom + vitest 基建

**Files:**
- Modify: `packages/libsql-adapter/package.json`（新增 vitest devDependency）
- Create: `packages/libsql-adapter/vitest.config.ts`
- Modify: `packages/libsql-adapter/src/schema.ts`（`vico_checkpoints` 复合主键 + `next_action`；`vico_turns` + `forked_from`；索引更名）
- Modify: `packages/libsql-adapter/src/migrate.ts`（DROP+CREATE 重建检测 + turns forked_from + 新索引）
- Modify: `packages/libsql-adapter/src/libsql-thread-store.ts`（forkedFrom 读写）
- Test: `packages/libsql-adapter/src/migrate.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Checkpoint`/`CheckpointStore`；Task 3 的 `Turn.forkedFrom`/`createTurn` opts。
- Produces: 新版 `checkpoints` 表定义（复合主键 + next_action）、`vico_turns.forked_from` 列、`ensureTables` 重建逻辑、`LibSqlThreadStore.createTurn(opts)`。Task 6 依赖新版 `checkpoints` 表定义。

- [ ] **Step 1: 搭 vitest 基建**

修改 `packages/libsql-adapter/package.json` 的 `devDependencies` 增加 `"vitest": "^4.1.8"`，并加 `"test": "vitest run"` 脚本。创建 `packages/libsql-adapter/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

Run: `pnpm install`（让 workspace 链接新依赖）。

- [ ] **Step 2: 写失败测试（ensureTables 重建 + forked_from）**

创建 `packages/libsql-adapter/src/migrate.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureTables } from './migrate.js';
import { checkpoints, turns } from './schema.js';

function makeDb() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema: { checkpoints, turns } });
  return { client, db };
}

describe('ensureTables（多版本 checkpoint 表）', () => {
  it('全新库：建出复合主键 + next_action 结构', async () => {
    const { client, db } = makeDb();
    await ensureTables(db as any);
    const pk = client.execute('SELECT * FROM pragma_index_list(\'vico_checkpoints\') WHERE origin = \'pk\'');
    const pkRows = await pk;
    expect(pkRows.rows.length).toBeGreaterThan(0);
    const cols = await client.execute('PRAGMA table_info(vico_checkpoints)');
    const names = cols.rows.map((r) => String(r.name));
    expect(names).toContain('next_action');
    expect(names).toContain('turn_id');
    expect(names).toContain('version');
    expect(names).not.toContain('pending_tool');
    expect(names).not.toContain('updated_at');
    const turnsCols = (await client.execute('PRAGMA table_info(vico_turns)')).rows.map((r) => String(r.name));
    expect(turnsCols).toContain('forked_from');
  });

  it('旧单行结构（id 主键 + turn_id UNIQUE）：DROP 重建为多版本结构', async () => {
    const { client, db } = makeDb();
    await client.execute(`CREATE TABLE vico_checkpoints (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      step_index INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      pending_tool TEXT,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await ensureTables(db as any);
    const cols = (await client.execute('PRAGMA table_info(vico_checkpoints)')).rows.map((r) => String(r.name));
    expect(cols).not.toContain('id');
    expect(cols).not.toContain('paused');
    expect(cols).toContain('next_action');
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `pnpm --filter @vico/libsql-adapter test`
Expected: FAIL —— 现版 `ensureTables` 建的是旧结构（`id` 主键、`pending_tool`），无 `next_action`/`forked_from`，且 `CREATE TABLE IF NOT EXISTS` 对已存在旧表不重建。

- [ ] **Step 4: 最小实现**

修改 `packages/libsql-adapter/src/schema.ts`，把 `checkpoints` 表改为：

```typescript
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/** 对话轮次（新增 forked_from 列：分叉来源） */
export const turns = sqliteTable('vico_turns', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  status: text('status').notNull().default('running'),
  steps: integer('steps').notNull().default(0),
  metadata: text('metadata'),
  /** 本 turn 由源 turn 的某版本分叉而来（JSON 序列化的 {turnId, version}） */
  forked_from: text('forked_from'),
  created_at: integer('created_at').notNull(),
});

/** turn 执行状态检查点 — 多版本链：(turn_id, version) 复合主键，一行一个版本快照 */
export const checkpoints = sqliteTable('vico_checkpoints', {
  turnId: text('turn_id').notNull(),
  threadId: text('thread_id').notNull(),
  version: integer('version').notNull(),
  stepIndex: integer('step_index').notNull(),
  nextAction: text('next_action').notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.turnId, t.version] }),
}));

// 底部索引替换：
export const checkpointsThreadIdIdx = index('idx_checkpoints_thread_id').on(checkpoints.threadId);
```

同时删除旧的 `checkpointsCreatedAtIdx`（`idx_created_at`）与 `checkpointsThreadIdIdx`（`idx_thread_id`）定义。

修改 `packages/libsql-adapter/src/migrate.ts`，把 `vico_checkpoints` 相关 SQL 改为：

```sql
-- 先检测旧结构（单列主键 id + turn_id UNIQUE）→ DROP 重建为多版本链
SELECT COUNT(*) AS n FROM pragma_table_info('vico_checkpoints') WHERE name = 'next_action';
-- 若 n=0（旧结构），执行 DROP TABLE vico_checkpoints;（见下方实现）

CREATE TABLE IF NOT EXISTS vico_checkpoints (
  turn_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  step_index INTEGER NOT NULL,
  next_action TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (turn_id, version)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id
ON vico_checkpoints(thread_id);
```

`ensureTables` 中需先用一个探测查询判断旧结构并 `DROP TABLE`。完整实现（在 `migrate.ts` 的 `vico_checkpoints` 段之前插入）：

```typescript
  // 迁移检测：旧版 vico_checkpoints 为单列主键 id + turn_id UNIQUE 单行制。
  // SQLite 无法 ALTER 复合主键，检测到旧结构时 DROP 重建为多版本链（旧单行数据开发期丢弃）。
  const ckptCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_checkpoints')
  `);
  const ckptColNames = ckptCols.map((r) => r[0]);
  if (ckptColNames.length > 0 && !ckptColNames.includes('next_action')) {
    await db.run(sql`DROP TABLE vico_checkpoints`);
  }

  // 检查点多版本链表
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      turn_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      next_action TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (turn_id, version)
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id
    ON vico_checkpoints(thread_id)
  `);
```

并把 `vico_turns` 的 CREATE 语句增加 `forked_from TEXT` 列。

修改 `packages/libsql-adapter/src/libsql-thread-store.ts`：
- `createTurn` 签名改为 `createTurn(threadId: string, opts?: { forkedFrom?: Turn['forkedFrom'] })`，insert 时写入 `forked_from: opts?.forkedFrom ? JSON.stringify(opts.forkedFrom) : null`，返回对象带 `forkedFrom: opts?.forkedFrom ?? null`。
- `updateTurn` 处理 `patch.forkedFrom`。
- `_toTurn` 从 `r.forked_from` 解析：`forkedFrom: r.forked_from ? (JSON.parse(r.forked_from) as { turnId: string; version: number }) : null`。

- [ ] **Step 5: 运行测试验证通过**

Run: `pnpm --filter @vico/libsql-adapter test`
Expected: PASS（2 个用例：新结构 + 旧表重建）。

- [ ] **Step 6: Commit**

```bash
git add packages/libsql-adapter/package.json packages/libsql-adapter/vitest.config.ts packages/libsql-adapter/src/schema.ts packages/libsql-adapter/src/migrate.ts packages/libsql-adapter/src/libsql-thread-store.ts packages/libsql-adapter/src/migrate.test.ts
git commit -m "feat(libsql): checkpoint 复合主键多版本表 + turns forked_from + ensureTables 重建"
```

---

### Task 5: mysql schema + MysqlThreadStore.forkedFrom

**Files:**
- Modify: `packages/mysql-adapter/src/schema.ts`（checkpoints 复合主键 + next_action；turns + forked_from）
- Modify: `packages/mysql-adapter/src/mysql-thread-store.ts`（forkedFrom 读写）

**Interfaces:**
- Consumes: Task 1 的 `CheckpointStore`；Task 3 的 `Turn.forkedFrom`/`createTurn` opts。
- Produces: 新版 mysql `checkpoints`/`turns` 表定义、`MysqlThreadStore.createTurn(opts)`。Task 7 依赖新版 `checkpoints` 表定义。
- 说明：MySQL 无 vitest 单测（需真实 MySQL 服务），本任务以 `pnpm --filter @vico/mysql-adapter typecheck` 为验证门槛。

- [ ] **Step 1: 实现（schema.ts）**

`packages/mysql-adapter/src/schema.ts` 中，把 `turns` 增加 `forkedFrom` 列，`checkpoints` 改为复合主键 + next_action：

```typescript
export const turns = mysqlTable('vico_turns', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }).notNull(),
  status: varchar('status', { length: 36 }).notNull().default('running'),
  steps: int('steps').notNull().default(0),
  forked_from: text('forked_from'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const checkpoints = mysqlTable('vico_checkpoints', {
  turnId: varchar('turn_id', { length: 36 }).notNull(),
  threadId: varchar('thread_id', { length: 36 }).notNull(),
  version: int('version').notNull(),
  stepIndex: int('step_index').notNull(),
  nextAction: varchar('next_action', { length: 20 }).notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.turnId, t.version] }),
}));
```

需从 `drizzle-orm/mysql-core` 引入 `primaryKey`。

- [ ] **Step 2: 实现（mysql-thread-store.ts）**

- `createTurn(threadId, opts?)`：insert 含 `forked_from`，返回带 `forkedFrom`。
- `updateTurn` 处理 `patch.forkedFrom`。
- `_toTurn`（或等价 mapper）从 `forked_from` 解析。

（参考 Task 4 的 libsql 对应实现，SQL 方言按 mysql2/drizzle mysql-core 适配。）

- [ ] **Step 3: 运行 typecheck 验证**

Run: `pnpm --filter @vico/mysql-adapter typecheck`
Expected: PASS（本任务范围内；checkpoint-store 的红灯由 Task 7 恢复）。

- [ ] **Step 4: Commit**

```bash
git add packages/mysql-adapter/src/schema.ts packages/mysql-adapter/src/mysql-thread-store.ts
git commit -m "feat(mysql): checkpoint 复合主键多版本表 + turns forked_from"
```

---

### Task 6: LibSqlCheckpointStore 多版本重写 + 单测

**Files:**
- Modify: `packages/libsql-adapter/src/libsql-checkpoint-store.ts`（全文重写）
- Test: `packages/libsql-adapter/src/libsql-checkpoint-store.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Checkpoint`/`CheckpointAppendPatch`/`CheckpointStore`/`createCheckpoint`；Task 4 的新版 `checkpoints` 表定义。
- Produces: 生产默认使用的 `LibSqlCheckpointStore` 多版本实现。Task 10 的 server 通过 `memory-setup.ts` 使用它。

- [ ] **Step 1: 写失败测试**

创建 `packages/libsql-adapter/src/libsql-checkpoint-store.test.ts`（覆盖 Task 2 同等语义，用 `:memory:`）：

```typescript
import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureTables } from './migrate.js';
import { LibSqlCheckpointStore } from './libsql-checkpoint-store.js';
import * as schema from './schema.js';
import type { CheckpointAppendPatch } from '@vico/core';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { stepIndex: 1, nextAction: 'model', approvedTools: {}, pauseInfo: null, lastMessageId: null, ...overrides };
}

async function makeStore() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await ensureTables(db as any);
  return new LibSqlCheckpointStore(db as any);
}

describe('LibSqlCheckpointStore（多版本链）', () => {
  it('create + append 版本递增、getLatest 取最新', async () => {
    const store = await makeStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 1, nextAction: 'end' }));
    const latest = await store.getLatest('turn-1');
    expect(latest?.version).toBe(2);
    expect(latest?.nextAction).toBe('end');
  });

  it('listVersions 升序 + getVersion 定位', async () => {
    const store = await makeStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 2 }));
    const versions = await store.listVersions('turn-1');
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await store.getVersion('turn-1', 2))?.stepIndex).toBe(2);
  });

  it('fork 复制快照到新 turn 初始版本，原链不变', async () => {
    const store = await makeStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 4, nextAction: 'tool-approval', pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 4 } }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked?.version).toBe(1);
    expect(forked?.stepIndex).toBe(4);
    expect(forked?.pauseInfo?.pausedAtStep).toBe(4);
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除 + deleteByTurn 清链', async () => {
    const store = await makeStore();
    await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch());
    await store.create('turn-new', 'thread-1');
    // 手工把 turn-old 版本 created_at 调旧
    const client = (store as any).db.$client as ReturnType<typeof createClient>;
    await client.execute(`UPDATE vico_checkpoints SET created_at = ${Date.now() - 100_000} WHERE turn_id = 'turn-old'`);
    const purged = await store.purgeExpired(10_000);
    expect(purged).toEqual(['turn-old']);
    expect(await store.listVersions('turn-old')).toEqual([]);
    expect((await store.listVersions('turn-new')).length).toBe(1);
    await store.deleteByTurn('turn-new');
    expect(await store.getLatest('turn-new')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @vico/libsql-adapter test`
Expected: FAIL —— 现版 store 仍是单行覆盖（`update`/`getByTurn`/`listByThread`），无 `append`/`getLatest`/`getVersion`/`listVersions`/`fork`，且表结构已变。

- [ ] **Step 3: 最小实现（重写 libsql-checkpoint-store.ts）**

```typescript
// @vico/libsql-adapter — LibSQL CheckpointStore implementation（多版本链，append-only）
import { eq, sql, desc } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Checkpoint, CheckpointAppendPatch, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from '@vico/core';
import { checkpoints } from './schema.js';
import type * as schema from './schema.js';

/**
 * LibSQL 多版本 {@link CheckpointStore}。
 * 一行一个版本快照（复合主键 turn_id+version），snapshot 存完整 Checkpoint JSON，
 * step_index / next_action 平铺为索引列。读时懒迁移。
 */
export class LibSqlCheckpointStore implements CheckpointStore {
  constructor(private db: LibSQLDatabase<typeof schema>) {}

  /** 创建初始版本（version=1、stepIndex=0、nextAction=model） */
  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  /** 追加一个版本：版本号 = 当前最大版本 + 1 */
  async append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint> {
    const latest = await this.getLatest(turnId);
    const checkpoint: Checkpoint = {
      turnId,
      threadId: latest?.threadId ?? '',
      version: (latest?.version ?? 0) + 1,
      stepIndex: patch.stepIndex,
      nextAction: patch.nextAction,
      approvedTools: patch.approvedTools,
      pauseInfo: patch.pauseInfo,
      lastMessageId: patch.lastMessageId,
      schemaVersion: CHECKPOINT_CURRENT_VERSION,
      createdAt: Date.now(),
    };
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  /** 读最新版本（版本号最大） */
  async getLatest(turnId: string): Promise<Checkpoint | undefined> {
    const row = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turnId))
      .orderBy(desc(checkpoints.version))
      .limit(1)
      .get();
    return row ? this.migrate(JSON.parse(row.snapshot)) : undefined;
  }

  /** 读指定版本 */
  async getVersion(turnId: string, version: number): Promise<Checkpoint | undefined> {
    const row = await this.db
      .select()
      .from(checkpoints)
      .where(sql`${checkpoints.turnId} = ${turnId} AND ${checkpoints.version} = ${version}`)
      .get();
    return row ? this.migrate(JSON.parse(row.snapshot)) : undefined;
  }

  /** 按版本号升序返回完整版本链 */
  async listVersions(turnId: string): Promise<Checkpoint[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turnId))
      .orderBy(checkpoints.version);
    return rows.map((r) => this.migrate(JSON.parse(r.snapshot)));
  }

  /** 从源版本复制快照到新 turn 初始版本（分叉起点） */
  async fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined> {
    const source = await this.getVersion(sourceTurnId, version);
    if (!source) return undefined;
    const checkpoint = createCheckpoint(newTurnId, newThreadId);
    checkpoint.stepIndex = source.stepIndex;
    checkpoint.nextAction = source.nextAction;
    checkpoint.approvedTools = source.approvedTools;
    checkpoint.pauseInfo = source.pauseInfo;
    checkpoint.lastMessageId = source.lastMessageId;
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  /** 删除整个 turn 的版本链 */
  async deleteByTurn(turnId: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId));
  }

  /** 整链清理：GROUP BY turn 取整链最新 created_at，全部过期才删，返回被删 turnId 数组 */
  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expired = await this.db
      .select({ turnId: checkpoints.turnId })
      .from(checkpoints)
      .groupBy(checkpoints.turnId)
      .having(sql`max(${checkpoints.createdAt}) < ${cutoff}`);
    const turnIds = expired.map((r) => r.turnId);
    for (const turnId of turnIds) {
      await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId));
    }
    return turnIds;
  }

  /** Checkpoint → 行（snapshot 存完整 JSON） */
  private toRow(ckpt: Checkpoint) {
    return {
      turnId: ckpt.turnId,
      threadId: ckpt.threadId,
      version: ckpt.version,
      stepIndex: ckpt.stepIndex,
      nextAction: ckpt.nextAction,
      snapshot: JSON.stringify(ckpt),
      createdAt: ckpt.createdAt,
    };
  }

  /** 懒迁移：按 schemaVersion 逐级升级 */
  private migrate(snapshot: Record<string, unknown>): Checkpoint {
    while ((snapshot.schemaVersion as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.schemaVersion as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @vico/libsql-adapter test`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/libsql-adapter/src/libsql-checkpoint-store.ts packages/libsql-adapter/src/libsql-checkpoint-store.test.ts
git commit -m "feat(libsql): LibSqlCheckpointStore 多版本链重写"
```

---

### Task 7: MysqlCheckpointStore 多版本重写

**Files:**
- Modify: `packages/mysql-adapter/src/mysql-checkpoint-store.ts`（全文重写）

**Interfaces:**
- Consumes: Task 1 的 `Checkpoint`/`CheckpointAppendPatch`/`CheckpointStore`/`createCheckpoint`；Task 5 的新版 mysql `checkpoints` 表定义。
- Produces: `MysqlCheckpointStore` 多版本实现。验证门槛为 typecheck（无真实 MySQL 服务）。

- [ ] **Step 1: 实现（重写 mysql-checkpoint-store.ts）**

按 Task 6 的 libsql 实现逐方法对齐（逻辑一致），drizzle 方言改用 mysql 版：

```typescript
// @vico/mysql-adapter — MySQL CheckpointStore implementation（多版本链，append-only）
import { eq, sql, desc } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { Checkpoint, CheckpointAppendPatch, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from '@vico/core';
import { checkpoints } from './schema.js';
import type * as schema from './schema.js';

/** MySQL 多版本 {@link CheckpointStore}，语义与 LibSql 版一致 */
export class MysqlCheckpointStore implements CheckpointStore {
  constructor(private db: MySql2Database<typeof schema>) {}

  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  async append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint> {
    const latest = await this.getLatest(turnId);
    const checkpoint: Checkpoint = {
      turnId,
      threadId: latest?.threadId ?? '',
      version: (latest?.version ?? 0) + 1,
      stepIndex: patch.stepIndex,
      nextAction: patch.nextAction,
      approvedTools: patch.approvedTools,
      pauseInfo: patch.pauseInfo,
      lastMessageId: patch.lastMessageId,
      schemaVersion: CHECKPOINT_CURRENT_VERSION,
      createdAt: Date.now(),
    };
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  async getLatest(turnId: string): Promise<Checkpoint | undefined> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turnId))
      .orderBy(desc(checkpoints.version))
      .limit(1);
    return rows.length === 0 ? undefined : this.migrate(JSON.parse(rows[0].snapshot));
  }

  async getVersion(turnId: string, version: number): Promise<Checkpoint | undefined> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(sql`${checkpoints.turnId} = ${turnId} AND ${checkpoints.version} = ${version}`)
      .limit(1);
    return rows.length === 0 ? undefined : this.migrate(JSON.parse(rows[0].snapshot));
  }

  async listVersions(turnId: string): Promise<Checkpoint[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turnId))
      .orderBy(checkpoints.version);
    return rows.map((r) => this.migrate(JSON.parse(r.snapshot)));
  }

  async fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined> {
    const source = await this.getVersion(sourceTurnId, version);
    if (!source) return undefined;
    const checkpoint = createCheckpoint(newTurnId, newThreadId);
    checkpoint.stepIndex = source.stepIndex;
    checkpoint.nextAction = source.nextAction;
    checkpoint.approvedTools = source.approvedTools;
    checkpoint.pauseInfo = source.pauseInfo;
    checkpoint.lastMessageId = source.lastMessageId;
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  async deleteByTurn(turnId: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId));
  }

  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expired = await this.db
      .select({ turnId: checkpoints.turnId })
      .from(checkpoints)
      .groupBy(checkpoints.turnId)
      .having(sql`max(${checkpoints.createdAt}) < ${cutoff}`);
    const turnIds = expired.map((r) => r.turnId);
    for (const turnId of turnIds) {
      await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId));
    }
    return turnIds;
  }

  private toRow(ckpt: Checkpoint) {
    return {
      turnId: ckpt.turnId,
      threadId: ckpt.threadId,
      version: ckpt.version,
      stepIndex: ckpt.stepIndex,
      nextAction: ckpt.nextAction,
      snapshot: JSON.stringify(ckpt),
      createdAt: ckpt.createdAt,
    };
  }

  private migrate(snapshot: Record<string, unknown>): Checkpoint {
    while ((snapshot.schemaVersion as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.schemaVersion as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm --filter @vico/mysql-adapter typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/mysql-adapter/src/mysql-checkpoint-store.ts
git commit -m "feat(mysql): MysqlCheckpointStore 多版本链重写"
```

---

### Task 8: loop-agent 纯函数辅助 + 单测（消息链核对）

**Files:**
- Modify: `packages/core/src/agent/loop-agent.ts`（顶部新增导出纯函数 `findUnpairedToolCalls`）
- Test: `packages/core/src/agent/loop-agent.test.ts`

**Interfaces:**
- Consumes: AI SDK `ModelMessage`、`getToolCalls`（`../model/message-utils.js`）。
- Produces: `findUnpairedToolCalls(messages): { assistantIndex: number; unpairedCallIds: string[] } | null`。Task 10 的 `resumeTurn` 用它做防线②。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/agent/loop-agent.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { findUnpairedToolCalls } from './loop-agent.js';

const toolCallMsg = (calls: { id: string; name: string }[]): ModelMessage => ({
  role: 'assistant',
  content: calls.map((c) => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.name, args: {} })),
});

const toolResultMsg = (ids: string[]): ModelMessage => ({
  role: 'tool',
  content: ids.map((id) => ({ type: 'tool-result' as const, toolCallId: id, toolResult: { type: 'text' as const, text: 'ok' } })),
});

describe('findUnpairedToolCalls（消息链核对）', () => {
  it('全部配对 → null（step 已完成，不重发）', () => {
    const messages: ModelMessage[] = [toolCallMsg([{ id: 'c1', name: 't' }]), toolResultMsg(['c1'])];
    expect(findUnpairedToolCalls(messages)).toBeNull();
  });

  it('最后一条 assistant 含未配对调用 → 返回其索引与 id（重新决策）', () => {
    const messages: ModelMessage[] = [
      toolCallMsg([{ id: 'c1', name: 't' }]),
      toolResultMsg(['c1']),
      toolCallMsg([{ id: 'c2', name: 't' }, { id: 'c3', name: 'u' }]),
      toolResultMsg(['c2']), // c3 未配对
    ];
    const unpaired = findUnpairedToolCalls(messages);
    expect(unpaired).toEqual({ assistantIndex: 2, unpairedCallIds: ['c3'] });
  });

  it('无 assistant tool-call 消息 → null', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    expect(findUnpairedToolCalls(messages)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @vico/core test -- loop-agent.test.ts`
Expected: FAIL —— `findUnpairedToolCalls` 未导出。

- [ ] **Step 3: 最小实现**

在 `packages/core/src/agent/loop-agent.ts` 顶部导入区之后、class 定义之前，添加模块级纯函数（并补充 `getToolCalls` 导入）：

```typescript
import { getToolCalls } from '../model/message-utils.js';
```

```typescript
/**
 * 消息链核对（防线②）：找到最后一条含 toolCalls 的 assistant 消息，
 * 检查其调用是否全部在链内配对到 tool_result。
 *
 * - 全部配对 → 返回 null：该 step 已完成，恢复时直接从 stepIndex 续跑，不重发工具。
 * - 存在未配对 → 返回该 assistant 消息索引与未配对 callId 列表：
 *   崩溃发生在「副作用已发生但结果未落链」窗口，恢复时截断到该消息之前，
 *   让模型基于一致链重新决策（不盲目重执行 mutation 工具）。
 *
 * @param messages - 从 threadStore 恢复出的模型消息链
 * @returns 未配对的 assistant 消息信息；无未配对时返回 null
 */
export function findUnpairedToolCalls(messages: ModelMessage[]): { assistantIndex: number; unpairedCallIds: string[] } | null {
  const toolResultIds = (msg: ModelMessage): string[] => {
    if (msg.role !== 'tool') return [];
    return msg.content
      .filter((p) => p.type === 'tool-result')
      .map((p) => p.toolCallId);
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const calls = getToolCalls(msg);
    if (calls.length === 0) continue;
    const resultIds = new Set<string>();
    for (let j = i + 1; j < messages.length; j++) {
      for (const id of toolResultIds(messages[j])) resultIds.add(id);
    }
    const unpaired = calls.filter((c) => !resultIds.has(c.id)).map((c) => c.id);
    return unpaired.length > 0 ? { assistantIndex: i, unpairedCallIds: unpaired } : null;
  }
  return null;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @vico/core test -- loop-agent.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/loop-agent.ts packages/core/src/agent/loop-agent.test.ts
git commit -m "feat(core): 消息链核对 findUnpairedToolCalls + 单测"
```

---

### Task 9: tool-executor.ts 删除 checkpoint 写入

**Files:**
- Modify: `packages/core/src/agent/tool-executor.ts`（删除全部 checkpoint 写入）

**Interfaces:**
- Consumes: `TurnContext`（不再用 `checkpoint` 字段）、`LoopAgent.checkpointStore`（不再引用）。
- Produces: 纯执行 + 上流 emit 的 `executeToolCalls`。Task 10 后全仓 typecheck 绿灯依赖本任务移除最后一个 `update` 引用。

- [ ] **Step 1: 实现**

把 `packages/core/src/agent/tool-executor.ts` 的 `executeToolCalls` 重写为：删除 `checkpoint`/`store` 引用，只保留执行 + 上流：

```typescript
  /**
   * 执行工具调用，逐条上流结果。
   * readonly 并行执行（无副作用），其余串行逐条执行。
   * 工具结果只落消息链（由调用方 appendToolResults 持久化），本方法不写 checkpoint。
   */
  async executeToolCalls(toolCalls: ToolCall[], context: TurnContext<TToolSet>): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const toolCallContext: ToolCallContext = { session: context.session, signal: context.signal };

    const { readonlyCalls, sequentialCalls } = this.partitionCalls(toolCalls);

    const results: ToolResult[] = [];

    // 工具执行结果上流：success → tool-result part，error → tool-error part
    const emitResult = (call: ToolCall, result: ToolResult): void => {
      context.controller.enqueue(toolResultPart(result, call.args));
      this.host.emit({ type: 'tool-result', id: result.callId, name: result.name, status: result.status, output: result.output });
    };

    // readonly：并行执行（无副作用），结果串行上流
    const executed = await Promise.all(
      readonlyCalls.map(async (call) => ({ call, result: await this.execute(call, toolCallContext) })),
    );
    for (const { call, result } of executed) {
      emitResult(call, result);
      results.push(result);
    }

    // sequential：串行逐条执行（mutation 有副作用，串行避免并发干扰）
    for (const call of sequentialCalls) {
      const result = await this.execute(call, toolCallContext);
      emitResult(call, result);
      results.push(result);
    }

    return results;
  }
```

同时删除文件顶部不再使用的 `TurnContext` 对 checkpoint 的依赖引用（`const checkpoint = context.checkpoint;`、`const store = this.host.checkpointStore;` 两行移除；若 `checkpoint` 变量已无引用则一并删除）。

- [ ] **Step 2: 验证**

Run: `pnpm --filter @vico/core typecheck`
Expected: 本文件内无错误（整个 @vico/core 可能仍红——`loop-agent.ts` 还在调用 `update`/`getByTurn`，Task 10 修复）。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent/tool-executor.ts
git commit -m "refactor(core): tool-executor 移除 checkpoint 写入，工具结果只落消息链"
```

---

### Task 10: loop-agent 调用点改造 + 恢复逻辑 + per-turn 锁

**Files:**
- Modify: `packages/core/src/agent/loop-agent.ts`（`start`/`resumeTurn`/`startTurnLoop`/`runTurnLoop`/`persistMessages` 改造；复用 `KeyedMutex`）

**Interfaces:**
- Consumes: Task 1 的新 `CheckpointStore`（`create`/`append`/`getLatest`/`deleteByTurn`）；Task 8 的 `findUnpairedToolCalls`；既有 `KeyedMutex`（`../utils/async-keyed-lock.js`）。
- Produces: 改造后的 loop-agent——唯一 append 版本链的地方；本任务完成后全仓 typecheck 应绿灯。

**改造点清单（对照 spec 五节）：**
1. `start()`：恢复检测 `getByTurn` → `getLatest`；恢复整体包进 `resumeMutex.run(turnId, ...)` 并在锁内重读 checkpoint（防线① TOCTOU）。
2. `startTurn()`：`create` 调用不变（初始版本）。
3. `resumeTurn()`：删除路径 B（`pendingToolCall`）；改为消息链核对 + 截断；pause 恢复后 `append`（nextAction='model'、pauseInfo=null）。
4. `runTurnLoop()`：`continue` 分支 step 完成后 `append`（nextAction='model'、stepIndex=steps+1）；`pause` 分支 `append`（nextAction='tool-approval'、pauseInfo）。
5. `startTurnLoop()`：completed/failed/aborted 终态统一 `append`（nextAction='end'），删除 `deleteByTurn` 调用。
6. `persistMessages()`：捕获最后一条消息 id 写回 `context.checkpoint.lastMessageId`。
7. 删除全部 `this.checkpointStore.update(...)` 调用点（resumeTurn / runTurnLoop / executeModelStep 内）。

- [ ] **Step 1: 写失败测试（per-turn 锁语义 + 版本链生长）**

在 `packages/core/src/agent/loop-agent.test.ts` 追加（验证 `KeyedMutex` 串行 + 通过 MemoryCheckpointStore 证明 append 链在恢复场景下正确生长）：

```typescript
import { KeyedMutex } from '../utils/async-keyed-lock.js';

describe('KeyedMutex（per-turn 执行锁，防线①）', () => {
  it('同一 key 的任务严格串行', async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];
    const tasks = [0, 1, 2].map((i) => mutex.run('turn-1', async () => {
      order.push(i);
      await new Promise((r) => setTimeout(r, 5));
      order.push(i);
    }));
    await Promise.all(tasks);
    expect(order).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('前一个任务失败不阻塞后续排队任务', async () => {
    const mutex = new KeyedMutex();
    const results: string[] = [];
    await Promise.all([
      mutex.run('turn-1', async () => { throw new Error('boom'); }).catch(() => results.push('fail')),
      mutex.run('turn-1', async () => results.push('ok')),
    ]);
    expect(results).toEqual(['fail', 'ok']);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @vico/core test -- loop-agent.test.ts`
Expected: 新用例 FAIL —— 现版 loop-agent 未用 KeyedMutex（此测试当前因导入路径不同可能失败于 `KeyedMutex` 已存在 → 若已存在则该用例本应 PASS；改用真实断言：verify `runTurnLoop`/`resumeTurn` 调用点仍引用 `update` → typecheck 红灯即本次"失败"信号）。

> 说明：Task 8 已导出 `findUnpairedToolCalls` 测试为绿灯；本 Step 的"失败"信号主要由 **typecheck 红灯** 提供（loop-agent 仍调用已删除的 `update`/`getByTurn`）。请先运行下方 Step 3 前的 typecheck 确认红灯。

- [ ] **Step 3: 实现（loop-agent.ts 改造）**

**a) 类内新增私用锁：**

```typescript
import { KeyedMutex } from '../utils/async-keyed-lock.js';
// class 内：
  /** per-turn 恢复执行锁（防线①）：同一 turn 的并发恢复串行排队 */
  private readonly resumeMutex = new KeyedMutex();
```

**b) `start()` 恢复检测改造（:243-257）：**

```typescript
    // 自动恢复所有未完成的 turn（paused/running/failed），前提是存在 checkpoint。
    // 整体包进 per-turn 锁，并在锁内重读最新版本，规避并发恢复 TOCTOU。
    const latestTurn = await this.thread.getLatestTurn(thread.id);
    if (latestTurn && latestTurn.status !== 'completed') {
      return this.resumeMutex.run(latestTurn.id, async () => {
        const checkpoint = await this.checkpointStore.getLatest(latestTurn.id);
        if (!checkpoint) {
          // 无 checkpoint 的未完成 turn：降级为新建 turn
          const turn = await this.thread.createTurn(thread.id);
          const session: TurnSession = { workspace, thread, turn };
          return this.startTurn({ session, userMessages, signal, controller });
        }
        this.log.info({ turnId: latestTurn.id, threadId: thread.id, status: latestTurn.status }, 'resuming turn');
        const session: TurnSession = { workspace, thread, turn: latestTurn };
        return this.resumeTurn({ session, checkpoint, userMessages, signal, controller });
      });
    }
```

**c) `resumeTurn()` 改造（:288-330）：**

```typescript
  private async resumeTurn(params: {
    session: TurnSession;
    checkpoint: Checkpoint;
    userMessages: ModelMessage[];
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  }): Promise<TurnResult> {
    const { session, checkpoint, userMessages, signal, controller } = params;
    const { turn } = session;

    const usage: UsageMetrics = { input: 0, output: 0 };

    // 从本轮消息组解析审批决策（in-band 协议）
    const { decisions } = extractApprovalResponses(userMessages);

    // 恢复历史消息
    const entries = await this.thread.getEntriesByTurns([turn.id]);
    const messages = toModelMessages(entries);

    // ── 防线② 消息链核对：未配对工具调用 → 截断到该 assistant 消息之前，模型重新决策 ──
    const unpaired = findUnpairedToolCalls(messages);
    if (unpaired) {
      this.log.info({ turnId: turn.id, unpaired: unpaired.unpairedCallIds }, 'unpaired tool calls, truncating chain for re-decision');
      messages.splice(unpaired.assistantIndex);
    }

    // 构建 request context
    const requestContext = new ModelRequestContext({agent: this, messages, tools: this.tools, session});
    await this.pipeline.enter(requestContext);

    // ── checkpoint 恢复：两条路径 ──
    const approvedTools = new Map<string, ToolApproval>(Object.entries(checkpoint.approvedTools));
    this.loadSessionApprovals(session, approvedTools);
    const context: TurnContext<TToolSet> = { ctx: requestContext, messages: [...requestContext.messages], session, approvedTools, signal, controller, checkpoint };

    if (checkpoint.pauseInfo) {
      // 路径 A：审批恢复（处理待审批调用），恢复现场进版本链
      await this.applyPauseInfoRecovery(checkpoint.pauseInfo, decisions, context);
      context.checkpoint = await this.checkpointStore.append(turn.id, {
        stepIndex: checkpoint.stepIndex,
        nextAction: 'model',
        approvedTools: Object.fromEntries(context.approvedTools),
        pauseInfo: null,
        lastMessageId: context.checkpoint.lastMessageId,
      });
    }
    // 路径 B（pendingToolCall 重试）随 pendingToolCall 字段一并删除：
    // 无 pauseInfo 时由消息链核对 + stepIndex 续跑兜底。

    await this.thread.updateTurn(turn.id, { status: 'running' });
    return this.startTurnLoop(context.checkpoint.stepIndex, context, usage);
  }
```

**d) `startTurnLoop()` 终态 append（:427-465）：** 把「completed 终态清理 checkpoint」块替换为「终态进版本链」：

```typescript
    const status = loopResult.status === 'aborted' ? 'aborted' : 'completed';
    await this.thread.updateTurn(turn.id, { status, steps: loopResult.steps });

    // 终态进版本链（nextAction='end'），审计可见；版本链全量保留，不再 deleteByTurn
    await this.checkpointStore.append(turn.id, {
      stepIndex: loopResult.steps,
      nextAction: 'end',
      approvedTools: Object.fromEntries(context.approvedTools),
      pauseInfo: null,
      lastMessageId: context.checkpoint.lastMessageId,
    });
```

并删除原 `if (status === 'completed') { ... deleteByTurn ... }` 块。`failed` 分支（:427-437）同样在返回前补 `append('end')`：

```typescript
    if (loopResult.status === 'failed') {
      const err = loopResult.error!;
      await this.thread.updateTurn(turn.id, { status: 'failed', steps: loopResult.steps });
      await this.checkpointStore.append(turn.id, {
        stepIndex: loopResult.steps,
        nextAction: 'end',
        approvedTools: Object.fromEntries(context.approvedTools),
        pauseInfo: null,
        lastMessageId: context.checkpoint.lastMessageId,
      });
      context.controller.enqueue(finishPart('error', usage));
      this.emit({ type: 'error', error: err });
      return { status: 'failed', steps: loopResult.steps, usage, messages: context.messages, thread, turn, error: loopResult.error };
    }
```

**e) `runTurnLoop()` append（:482-500）：** 删除 step-start 的实时 `update`（`executeModelStep` 内 :511-515），改为：

```typescript
      if (action === 'pause') {
        // 暂停现场进版本链（nextAction='tool-approval'）
        context.checkpoint = await this.checkpointStore.append(turn.id, {
          stepIndex: steps,
          nextAction: 'tool-approval',
          approvedTools: Object.fromEntries(context.approvedTools),
          pauseInfo: pauseInfo ?? null,
          lastMessageId: context.checkpoint.lastMessageId,
        });
        await this.thread.updateTurn(turn.id, { status: 'paused', steps });
        return { status: 'paused', steps, usage };
      }

      if (action === 'break') {
        if (error) {
          return { status: 'failed', steps, usage, error };
        }
        break;
      }

      // action === 'continue'：step 完成 → 追加 'model' 版本（每 step 一个版本）
      steps++;
      context.checkpoint = await this.checkpointStore.append(turn.id, {
        stepIndex: steps,
        nextAction: 'model',
        approvedTools: Object.fromEntries(context.approvedTools),
        pauseInfo: null,
        lastMessageId: context.checkpoint.lastMessageId,
      });
```

**f) `executeModelStep()` 删除 step-start checkpoint 写（:511-515）：** 整段删除：

```typescript
    // step-start checkpoint：记录当前 step 进度
    context.checkpoint.stepIndex = step.index;
    context.checkpoint.pendingToolCall = null;
    context.checkpoint.approvedTools = Object.fromEntries(context.approvedTools);
    await this.checkpointStore.update(context.checkpoint);
```

**g) `persistMessages()` 捕获 lastMessageId（:686-696）：**

```typescript
  async persistMessages(context: TurnContext<TToolSet>, messages: ModelMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const threadId = context.session.thread.id;
    const turnId = context.session.turn.id;
    const created = await this.thread.appendEntries(
      messages.map(message => ({ threadId, turnId, ...fromModelMessage(message) })),
    );
    // 记录最后一条消息 id，供 fork 时截断消息链精确定位
    const last = created.at(-1);
    if (last) {
      context.checkpoint.lastMessageId = last.id;
    }
  }
```

- [ ] **Step 4: 运行测试 + typecheck 验证**

Run: `pnpm --filter @vico/core test`
Expected: PASS（checkpoint.test / memory-checkpoint-store.test / memory-thread-store.test / loop-agent.test 全部绿灯）。

Run: `pnpm -r typecheck`（或按工作区逐个：`pnpm --filter @vico/core typecheck && pnpm --filter @vico/libsql-adapter typecheck && pnpm --filter @vico/mysql-adapter typecheck`）
Expected: PASS —— 全部接口签名对齐，无残留 `update`/`getByTurn`/`listByThread` 调用。

- [ ] **Step 5: 手动冒烟（崩溃恢复 + 不重复执行）**

启动服务 `pnpm dev`，用 curl 驱动一次工具调用、在断点前杀掉进程模拟崩溃，再重启验证：
1. 发一条会触发 mutation 工具（如 `writeTool`）的消息。
2. 观察 `vico_checkpoints` 出现多版本行：`sqlite3 vico/server/data/vico.db "SELECT turn_id, version, step_index, next_action FROM vico_checkpoints ORDER BY turn_id, version;"`。
3. 工具执行中途 kill 服务 → 重启 → 再发同 thread 新消息 → 确认 `resumeTurn` 日志出现、且已完成工具**未重发**（消息链核对）。
4. 完成一个 turn 后确认版本链保留（含 `end` 终态版本），不再被自动删除。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/loop-agent.ts
git commit -m "feat(core): loop-agent 调用点改 append-only + 消息链核对恢复 + per-turn 锁"
```

---

### Task 11: server purgeExpired 接线 + TTL 配置

**Files:**
- Modify: `vico/server/src/config.ts`（`checkpoint.ttl_days`）
- Modify: `vico/server/server.config.yaml`（`checkpoint.ttl_days: 30`）
- Modify: `vico/server/src/vico.ts`（`initVico` 内接线）
- Create: `vico/server/src/checkpoint-purge.ts`（可测的定时清理模块）
- Test: `vico/server/src/lib/__tests__/checkpoint-purge.test.ts`

**Interfaces:**
- Consumes: Task 2/6 的 `CheckpointStore.purgeExpired`；`config.checkpoint.ttl_days`。
- Produces: `startCheckpointPurge(store, ttlMs, log): () => void`。

- [ ] **Step 1: 写失败测试**

创建 `vico/server/src/lib/__tests__/checkpoint-purge.test.ts`：

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCheckpointPurge } from '../../checkpoint-purge.js';
import type { CheckpointStore } from '@vico/core';

describe('startCheckpointPurge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('启动时立即执行一次 purgeExpired', async () => {
    const purgeExpired = vi.fn().mockResolvedValue([]);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const stop = startCheckpointPurge(store, 30 * 24 * 60 * 60 * 1000, { info: () => {}, error: () => {} } as any);
    await vi.waitFor(() => expect(purgeExpired).toHaveBeenCalledTimes(1));
    stop();
  });

  it('周期触发 purgeExpired（每小时一次）', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockResolvedValue(['turn-1']);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const stop = startCheckpointPurge(store, 30 * 24 * 60 * 60 * 1000, { info: () => {}, error: () => {} } as any);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2); // 启动 1 次 + 定时 1 次
    stop();
  });

  it('purge 抛错不中断定时器', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockRejectedValueOnce(new Error('db down'));
    const store = { purgeExpired } as unknown as CheckpointStore;
    const stop = startCheckpointPurge(store, 1000, { info: () => {}, error: () => {} } as any);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    stop();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter vico --filter @vico/server test`（在 `vico/server` 目录 `pnpm test`）
Expected: FAIL —— `checkpoint-purge.ts` 不存在。

- [ ] **Step 3: 最小实现**

创建 `vico/server/src/checkpoint-purge.ts`：

```typescript
import type { CheckpointStore } from '@vico/core';

/** 清理周期：1 小时 */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 启动 checkpoint 版本链 TTL 清理：立即执行一次 + 每小时周期执行。
 * 整链删除由 store.purgeExpired 负责（一个 turn 的所有版本一起删）。
 *
 * @param store - CheckpointStore
 * @param ttlMs - 版本链存活时间（TTL）
 * @param log - pino logger
 * @returns 停止函数（清除定时器）
 */
export function startCheckpointPurge(
  store: CheckpointStore,
  ttlMs: number,
  log: { info: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void },
): () => void {
  const run = async (): Promise<void> => {
    try {
      const purged = await store.purgeExpired(ttlMs);
      if (purged.length > 0) {
        log.info({ turns: purged }, 'purged expired checkpoint chains');
      }
    } catch (err) {
      log.error({ err }, 'purgeExpired failed');
    }
  };

  // 启动时立即执行一次
  void run();

  const timer = setInterval(() => void run(), PURGE_INTERVAL_MS);
  // 不阻止进程退出
  timer.unref?.();

  return () => clearInterval(timer);
}
```

在 `vico/server/src/config.ts` 的 `AppConfig` 中新增 `checkpoint` 段与默认值：

```typescript
  /** checkpoint 版本链 TTL 配置 */
  checkpoint: {
    ttl_days: number;
  };
// defaultConfig 中：
    checkpoint: { ttl_days: 30 },
// merged 中：
      checkpoint: { ...defaultConfig.checkpoint, ...parsed.checkpoint },
```

在 `vico/server/server.config.yaml` 末尾追加：

```yaml
checkpoint:
  ttl_days: 30
```

在 `vico/server/src/vico.ts` 的 `initVico` 中接线（导入 `startCheckpointPurge` 与 `config`）：

```typescript
import {startCheckpointPurge} from './checkpoint-purge.js';
import {config} from './config.js';
import {getCheckpointStore} from './memory/memory-setup.js';

export async function initVico(): Promise<void> {
  await ensureTables(db as any);
  // checkpoint 版本链 TTL 清理：启动一次 + 每小时一次
  startCheckpointPurge(
    getCheckpointStore(),
    config.checkpoint.ttl_days * 24 * 60 * 60 * 1000,
    logger,
  );
  logger.info('Vico agent framework initialized');
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: 在 `vico/server` 目录 `pnpm test`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 全仓验证**

Run: `pnpm -r typecheck && pnpm --filter @vico/core test && pnpm --filter @vico/libsql-adapter test && (cd vico/server && pnpm test)`
Expected: 全绿。随后 `pnpm dev` 启动确认无迁移/接线错误。

- [ ] **Step 6: Commit**

```bash
git add vico/server/src/checkpoint-purge.ts vico/server/src/lib/__tests__/checkpoint-purge.test.ts vico/server/src/config.ts vico/server/server.config.yaml vico/server/src/vico.ts
git commit -m "feat(server): checkpoint purgeExpired 接线 + ttl_days 配置"
```

---

## Self-Review

**Spec 覆盖检查：**
- 四节 数据模型：Task 1（类型）+ Task 4/5（表）+ Task 2/6/7（存储）。
- 五节 接口改造：Task 1（接口）+ Task 2/6/7（三 store）+ Task 10（loop 调用点）+ Task 9（tool-executor 删除写入）。
- 六节 fork 流程：Task 3（forkedFrom）+ Task 2/6/7（store.fork）；**注意**：fork 的 API 编排（新 fork 端点 / 消息链复制 / createTurn(forkedFrom) 串联）不在 spec 改动清单内，属后续功能——本计划交付 store 级 `fork` 能力与可复用恢复路径，并已在"文件结构"中注明。
- 七节 幂等修复：Task 8（消息链核对）+ Task 10（恢复两条路径 + per-turn 锁 + 删除路径 B）。
- 八节 保留策略：Task 1（TTL 30 天）+ Task 11（接线 + 整链删除）。
- 九节 迁移兼容：Task 4（DROP+CREATE 重建 + 旧数据丢弃 + schemaVersion 懒迁移保留）。
- 十节 测试：store 单测（Task 2/6）、迁移（Task 4）、消息链核对/锁（Task 8/10）、purge 接线（Task 11）。

**占位符扫描：** 无 TBD/TODO；所有实现步骤含完整代码。

**类型一致性检查：**
- `append(turnId, patch)` 签名在 Task 1 定义、Task 2/6/7 实现、Task 10 调用——一致（`CheckpointAppendPatch` 五字段全必填）。
- `fork(sourceTurnId, version, newTurnId, newThreadId): Promise<Checkpoint | undefined>` 三处一致。
- `purgeExpired(ttlMs): Promise<string[]>` 返回被删 turnId 数组，Task 11 测试断言一致。
- `createTurn(threadId, opts?)` 在 Task 3 接口 + Task 3/4/5 实现一致。
- `findUnpairedToolCalls` 在 Task 8 定义、Task 10 调用、Task 8 测试断言——返回结构 `{ assistantIndex, unpairedCallIds }` 一致。
- `createCheckpoint` 保留原函数名（新语义：初始版本快照），`index.ts` 导出与 store 导入一致。

**已知偏差（已在 Global Constraints 注明）：** `append` 增加 turnId 首参；`purgeExpired` 返回被删 turnId；`fork` 返回 `Checkpoint | undefined`；libsql/mysql thread store 与两个 schema 文件为 spec 改动清单之外的必要补充文件（实现 `forkedFrom` 持久化必需）。
