# Checkpoint 版本树 + pauseInfo 平铺 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 checkpoint 从「(turn_id,version) 复合主键多版本链」升级为「全局 uuid id + parentId 显式版本树」，并把嵌套 PauseInfo 平铺到 Checkpoint 顶层以简化 resume 单路径。

**Architecture:** core 定义新类型（Checkpoint 含 id/parentId/平铺字段，删 PauseInfo）；内存/libsql/mysql 三个 store 实现 id 生成与 getById；loop-agent 双路径 resume 并单路径（gate 改 `nextAction !== 'tool-approval'`）；适配器 migrate.ts 检测旧结构 DROP 重建（schemaVersion 2）。

**Tech Stack:** TypeScript、drizzle-orm、better-sqlite3/libsql、mysql2、vitest、pnpm monorepo

**Spec:** [2026-09-01-checkpoint-version-tree-design.md](../specs/2026-09-01-checkpoint-version-tree-design.md)

## Global Constraints

- `CHECKPOINT_CURRENT_VERSION = 2`；`checkpointMigrations` 保持空映射。
- `Checkpoint` 字段（14 个）：`id: string`（uuid）、`parentId: string | null`、`turnId`、`threadId`、`version`、`stepIndex`、`nextAction`、`approvedTools`、`pendingApprovalCalls: ToolCall[]`、`approvedCalls: ToolCall[]`、`deniedResults: ToolResult[]`、`lastMessageId`、`schemaVersion`、`createdAt`。
- `CheckpointAppendPatch` 8 字段全必填：`parentId`、`stepIndex`、`nextAction`、`approvedTools`、`pendingApprovalCalls`、`approvedCalls`、`deniedResults`、`lastMessageId`。
- `PauseInfo` 类型删除；`reason` 并入 `nextAction`；`pausedAtStep` 删除（`stepIndex` 替代）。
- `CheckpointStore` 新增 `getById(id: string): Promise<Checkpoint | undefined>`，三个 store 全部实现。
- uuid 生成一律 `crypto.randomUUID()`。
- resume 防线② gate = `checkpoint.nextAction !== 'tool-approval'`。
- `vico_checkpoints` 主键 = `id` 单列 + `UNIQUE(turn_id, version)`；含 `parent_id` 列。
- migrate.ts 检测旧结构（缺 `id` 或 `parent_id` 列）→ `DROP TABLE vico_checkpoints` 后重建。libsql 用 `PRAGMA table_info`，mysql 用 `INFORMATION_SCHEMA.COLUMNS`。
- `snapshot` 列存完整 Checkpoint JSON（含 id/parentId 与平铺字段）。

---

### Task 1: core 类型模型 + 内存 store

**Files:**
- Modify: `packages/core/src/agent/checkpoint.ts`
- Modify: `packages/core/src/agent/memory-checkpoint-store.ts`
- Modify: `packages/core/src/agent/checkpoint.test.ts`
- Modify: `packages/core/src/agent/memory-checkpoint-store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ToolCall`/`ToolResult`（`../tool/types.js`）、`ToolApproval`（`./loop-agent-options.js`）
- Produces: 新 `Checkpoint`/`CheckpointAppendPatch`/`CheckpointStore`（+`getById`）/`createCheckpoint` —— Task 2 的 loop-agent 与 Task 3/4 的适配器全部依赖。
- ⚠️ 本任务完成后 `@vico/core` 包整体暂不编译（loop-agent 仍引用 `PauseInfo`），验证用**定向 vitest**，勿跑全量。

- [ ] **Step 1: 更新 checkpoint.test.ts 为新契约（先红）**

把 `checkpoint.test.ts` 的 createCheckpoint 断言改为新字段：

```typescript
import { describe, expect, it } from 'vitest';
import { createCheckpoint, DEFAULT_CHECKPOINT_TTL, CHECKPOINT_CURRENT_VERSION } from './checkpoint.js';

describe('createCheckpoint（初始版本快照）', () => {
  it('生成 id / parentId=null / version=1 / 平铺字段空数组', () => {
    const ckpt = createCheckpoint('turn-1', 'thread-1');
    expect(ckpt.id).toBeTruthy();
    expect(ckpt.parentId).toBeNull();
    expect(ckpt.turnId).toBe('turn-1');
    expect(ckpt.threadId).toBe('thread-1');
    expect(ckpt.version).toBe(1);
    expect(ckpt.stepIndex).toBe(0);
    expect(ckpt.nextAction).toBe('model');
    expect(ckpt.approvedTools).toEqual({});
    expect(ckpt.pendingApprovalCalls).toEqual([]);
    expect(ckpt.approvedCalls).toEqual([]);
    expect(ckpt.deniedResults).toEqual([]);
    expect(ckpt.lastMessageId).toBeNull();
    expect(ckpt.schemaVersion).toBe(CHECKPOINT_CURRENT_VERSION);
    expect(ckpt.createdAt).toBeGreaterThan(0);
  });

  it('TTL 默认为 30 天', () => {
    expect(DEFAULT_CHECKPOINT_TTL).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: 更新 memory-checkpoint-store.test.ts 为新契约（先红）**

`patch()` 助手扩为 8 字段；删除 `pauseInfo` 相关断言，改为 `nextAction` + 平铺字段；新增 `getById` 与 fork parentId 断言：

```typescript
import { describe, expect, it } from 'vitest';
import { MemoryCheckpointStore } from './memory-checkpoint-store.js';
import type { Checkpoint, CheckpointAppendPatch } from './checkpoint.js';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { parentId: null, stepIndex: 1, nextAction: 'model', approvedTools: {}, pendingApprovalCalls: [], approvedCalls: [], deniedResults: [], lastMessageId: null, ...overrides };
}

describe('MemoryCheckpointStore（版本树）', () => {
  it('create 生成初始版本（id 非空、version=1、nextAction=model）', async () => {
    const store = new MemoryCheckpointStore();
    const ckpt = await store.create('turn-1', 'thread-1');
    expect(ckpt.id).toBeTruthy();
    expect(ckpt.parentId).toBeNull();
    expect(ckpt.version).toBe(1);
    expect(ckpt.stepIndex).toBe(0);
    expect(ckpt.nextAction).toBe('model');
  });

  it('append 生成 uuid id 并采用 patch.parentId，version 递增', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 1, nextAction: 'tool-approval', pendingApprovalCalls: [{ id: 'call-1', name: 'webSearch', args: {} }] }));
    const v3 = await store.append('turn-1', patch({ parentId: v2.id, stepIndex: 2, nextAction: 'end' }));
    expect(v2.id).toBeTruthy();
    expect(v2.parentId).toBe(v1.id);
    expect(v2.version).toBe(2);
    expect(v2.nextAction).toBe('tool-approval');
    expect(v2.pendingApprovalCalls.length).toBe(1);
    expect(v3.version).toBe(3);
    expect(v3.pendingApprovalCalls).toEqual([]); // patch 显式覆盖，不继承 v2
  });

  it('getLatest / getVersion / getById 读取', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 2, nextAction: 'end' }));
    expect((await store.getLatest('turn-1'))?.version).toBe(2);
    expect((await store.getVersion('turn-1', 1))?.id).toBe(v1.id);
    expect((await store.getById(v2.id))?.nextAction).toBe('end');
    expect(await store.getById('nope')).toBeUndefined();
  });

  it('listVersions 按版本号升序返回', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ parentId: v1.id }));
    await store.append('turn-1', patch({ parentId: v1.id }));
    const versions = await store.listVersions('turn-1');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('fork 新 turn v1 的 parentId 指向源版本 id，原链不变', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 3, nextAction: 'tool-approval' }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked).toBeDefined();
    expect(forked!.version).toBe(1);
    expect(forked!.threadId).toBe('thread-2');
    expect(forked!.stepIndex).toBe(3);
    expect(forked!.nextAction).toBe('tool-approval');
    expect(forked!.parentId).toBe(v2.id); // 跨 turn 父引用
    expect((await store.listVersions('turn-1')).map((v) => v.version)).toEqual([1, 2]);
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除 + deleteByTurn 清链', async () => {
    const store = new MemoryCheckpointStore();
    const a = await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch({ parentId: a.id }));
    await store.create('turn-new', 'thread-1');
    const rawStore = store as unknown as { store: Map<string, Checkpoint> };
    for (const ckpt of rawStore.store.values()) {
      if (ckpt.turnId === 'turn-old') ckpt.createdAt = Date.now() - 100_000;
    }
    const purged = await store.purgeExpired(10_000);
    expect(purged).toEqual(['turn-old']);
    expect(await store.listVersions('turn-old')).toEqual([]);
    expect((await store.listVersions('turn-new')).length).toBe(1);
    await store.deleteByTurn('turn-new');
    expect(await store.getLatest('turn-new')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行定向测试确认失败**

Run: `pnpm --filter @vico/core exec vitest run src/agent/checkpoint.test.ts src/agent/memory-checkpoint-store.test.ts`
Expected: FAIL（类型错误 / `pauseInfo` 属性不存在）

- [ ] **Step 4: 重写 checkpoint.ts 类型模型**

完整替换 `packages/core/src/agent/checkpoint.ts`：

```typescript
// @vico/core - Checkpoint 版本树类型 + CheckpointStore 接口 + 版本迁移
import type {ToolCall, ToolResult} from '../tool/types.js';
import type {ToolApproval} from './loop-agent-options.js';
import {randomUUID} from 'node:crypto';

/** checkpoint 快照（snapshot JSON）schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 2;

/** 下一步意图：模型调用 / 等待审批 / 已结束（原 PauseInfo.reason 并入） */
export type NextAction = 'model' | 'tool-approval' | 'end';

/**
 * vico_checkpoints 一行 = 一个版本（完整快照）。
 * id 为全局唯一版本节点 id；parentId 指向上一版本（可跨 turn，fork 时指向源版本）。
 * version 为 turn 内单调递增序号（append max+1），仅作顺序/审计标签；血缘由 parentId 表达。
 */
export interface Checkpoint {
  id: string;
  parentId: string | null;
  turnId: string;
  threadId: string;
  version: number;
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  // —— 原 PauseInfo 平铺（恒为数组）——
  pendingApprovalCalls: ToolCall[];
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  lastMessageId: string | null;
  schemaVersion: number;
  createdAt: number;
}

/**
 * append 追加一个版本的增量 patch。全部必填 —— 合并语义为「patch 字段全量覆盖最新版本快照」。
 * parentId 显式传入（= 当前 context.checkpoint.id），支持从非最新叶续跑时正确挂接父版本。
 */
export interface CheckpointAppendPatch {
  parentId: string | null;
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  pendingApprovalCalls: ToolCall[];
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  lastMessageId: string | null;
}

/** CheckpointStore 接口（append-only 版本树） */
export interface CheckpointStore {
  /** 创建初始版本（id=uuid、parentId=null、version=1、stepIndex=0、nextAction=model），turn 开始时调用 */
  create(turnId: string, threadId: string): Promise<Checkpoint>;
  /** 追加一个版本：version = 该 turn 最大版本 + 1，生成新 uuid id，parentId 由 patch 显式指定 */
  append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint>;
  /** 读最新版本（version 最大） */
  getLatest(turnId: string): Promise<Checkpoint | undefined>;
  /** 读指定版本 */
  getVersion(turnId: string, version: number): Promise<Checkpoint | undefined>;
  /** 按 id 读版本（父引用解析、指定叶恢复） */
  getById(id: string): Promise<Checkpoint | undefined>;
  /** 按 version 升序返回，审计时间线 */
  listVersions(turnId: string): Promise<Checkpoint[]>;
  /** 从源版本复制快照到新 turn 初始版本，parentId = 源版本 id（跨 turn 边）；源不存在返回 undefined */
  fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined>;
  /** 删除整个 turn 的版本树 */
  deleteByTurn(turnId: string): Promise<void>;
  /** 按整链 created_at 清理；返回被删 turnId 数组 */
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/** 构造初始版本快照（id=uuid、parentId=null、version=1、平铺字段空数组） */
export function createCheckpoint(turnId: string, threadId: string): Checkpoint {
  return {
    id: randomUUID(),
    parentId: null,
    turnId,
    threadId,
    version: 1,
    stepIndex: 0,
    nextAction: 'model',
    approvedTools: {},
    pendingApprovalCalls: [],
    approvedCalls: [],
    deniedResults: [],
    lastMessageId: null,
    schemaVersion: CHECKPOINT_CURRENT_VERSION,
    createdAt: Date.now(),
  };
}

/** 版本迁移函数映射：schemaVersion N → N+1（DROP 重建后无存量 v1，链保持空） */
export const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {};

/** 默认 checkpoint 存活时间：30 天 */
export const DEFAULT_CHECKPOINT_TTL = 30 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 5: 重写 memory-checkpoint-store.ts**

完整替换 `packages/core/src/agent/memory-checkpoint-store.ts`：

```typescript
// @vico/core — In-memory CheckpointStore implementation（版本树，append-only）
import type { Checkpoint, CheckpointAppendPatch, CheckpointStore } from './checkpoint.js';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from './checkpoint.js';
import { randomUUID } from 'node:crypto';

/**
 * In-memory 版本树 {@link CheckpointStore}。
 * 以 `${turnId}:${version}` 为 key 存一个 turn 的完整版本，血缘由 parentId 表达，支持懒迁移。
 */
export class MemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, Checkpoint>();

  private key(turnId: string, version: number): string {
    return `${turnId}:${version}`;
  }

  /** 创建初始版本（id=uuid、parentId=null、version=1），turn 开始时调用 */
  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    this.store.set(this.key(turnId, checkpoint.version), checkpoint);
    return this.snapshot(checkpoint);
  }

  /** 追加一个版本：version = max+1，生成新 uuid id，parentId 由 patch 显式指定 */
  async append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint> {
    const latest = await this.getLatest(turnId);
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      parentId: patch.parentId,
      turnId,
      threadId: latest?.threadId ?? '',
      version: (latest?.version ?? 0) + 1,
      stepIndex: patch.stepIndex,
      nextAction: patch.nextAction,
      approvedTools: patch.approvedTools,
      pendingApprovalCalls: patch.pendingApprovalCalls,
      approvedCalls: patch.approvedCalls,
      deniedResults: patch.deniedResults,
      lastMessageId: patch.lastMessageId,
      schemaVersion: CHECKPOINT_CURRENT_VERSION,
      createdAt: Date.now(),
    };
    this.store.set(this.key(turnId, checkpoint.version), checkpoint);
    return this.snapshot(checkpoint);
  }

  /** 读最新版本（version 最大） */
  async getLatest(turnId: string): Promise<Checkpoint | undefined> {
    let latest: Checkpoint | undefined;
    for (const ckpt of this.store.values()) {
      if (ckpt.turnId === turnId && (!latest || ckpt.version > latest.version)) {
        latest = ckpt;
      }
    }
    return latest ? this.snapshot(this.migrate(latest)) : undefined;
  }

  /** 读指定版本 */
  async getVersion(turnId: string, version: number): Promise<Checkpoint | undefined> {
    const ckpt = this.store.get(this.key(turnId, version));
    return ckpt ? this.snapshot(this.migrate(ckpt)) : undefined;
  }

  /** 按 id 读版本 */
  async getById(id: string): Promise<Checkpoint | undefined> {
    for (const ckpt of this.store.values()) {
      if (ckpt.id === id) return this.snapshot(this.migrate(ckpt));
    }
    return undefined;
  }

  /** 按 version 升序返回完整版本树 */
  async listVersions(turnId: string): Promise<Checkpoint[]> {
    const versions: Checkpoint[] = [];
    for (const ckpt of this.store.values()) {
      if (ckpt.turnId === turnId) versions.push(this.snapshot(this.migrate(ckpt)));
    }
    versions.sort((a, b) => a.version - b.version);
    return versions;
  }

  /** 从源版本复制快照到新 turn 初始版本，parentId = 源版本 id（跨 turn 边） */
  async fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined> {
    const source = await this.getVersion(sourceTurnId, version);
    if (!source) return undefined;
    const checkpoint = createCheckpoint(newTurnId, newThreadId);
    checkpoint.parentId = source.id;
    checkpoint.stepIndex = source.stepIndex;
    checkpoint.nextAction = source.nextAction;
    checkpoint.approvedTools = { ...source.approvedTools };
    checkpoint.pendingApprovalCalls = [...source.pendingApprovalCalls];
    checkpoint.approvedCalls = [...source.approvedCalls];
    checkpoint.deniedResults = [...source.deniedResults];
    checkpoint.lastMessageId = source.lastMessageId;
    this.store.set(this.key(newTurnId, checkpoint.version), checkpoint);
    return this.snapshot(checkpoint);
  }

  /** 删除整个 turn 的版本树 */
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

  /** 返回防御性拷贝（含平铺数组），避免调用方原地改动污染已存储版本 */
  private snapshot(ckpt: Checkpoint): Checkpoint {
    return {
      ...ckpt,
      approvedTools: { ...ckpt.approvedTools },
      pendingApprovalCalls: [...ckpt.pendingApprovalCalls],
      approvedCalls: [...ckpt.approvedCalls],
      deniedResults: [...ckpt.deniedResults],
    };
  }
}
```

- [ ] **Step 6: 更新 index.ts 导出**

`packages/core/src/index.ts` 第 167 行改为（删 `PauseInfo`）：

```typescript
export { type Checkpoint, type CheckpointAppendPatch, type CheckpointStore, type NextAction, CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint, DEFAULT_CHECKPOINT_TTL } from './agent/checkpoint.js';
```

- [ ] **Step 7: 运行定向测试确认通过**

Run: `pnpm --filter @vico/core exec vitest run src/agent/checkpoint.test.ts src/agent/memory-checkpoint-store.test.ts`
Expected: PASS（2 文件全绿）

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent/checkpoint.ts packages/core/src/agent/memory-checkpoint-store.ts packages/core/src/agent/checkpoint.test.ts packages/core/src/agent/memory-checkpoint-store.test.ts packages/core/src/index.ts
git commit -m "feat(core): checkpoint 类型升级为 id+parentId 版本树，pauseInfo 平铺"
```

---

### Task 2: core loop-agent 单路径 resume

**Files:**
- Modify: `packages/core/src/agent/loop-agent-options.ts`
- Modify: `packages/core/src/agent/loop-agent.ts`
- Test: `packages/core/src/agent/loop-agent.test.ts`（findUnpairedToolCalls 用例不受影响，全量跑验证）

**Interfaces:**
- Consumes: Task 1 的新 `Checkpoint`/`CheckpointAppendPatch`
- Produces: `ModelStepResult` 平铺字段（`pendingApprovalCalls?`/`approvedCalls?`/`deniedResults?`）；`applyPauseInfoRecovery(checkpoint: Checkpoint, ...)`；所有 append 调用点带 `parentId` + 平铺字段

- [ ] **Step 1: 改 loop-agent-options.ts 的 ModelStepResult**

把第 9-18 行替换为：

```typescript
/** executeModelStep 返回值 */
export interface ModelStepResult {
  /** 步骤执行后的动作：break=终止循环, pause=暂停等待审批, continue=继续下一步 */
  action: 'break' | 'pause' | 'continue';
  /** 待审批的 ToolCall（action 为 pause 时需要） */
  pendingApprovalCalls?: ToolCall[];
  /** 审批阶段已自动批准的调用（action 为 pause 时需要，恢复时直接执行） */
  approvedCalls?: ToolCall[];
  /** 已自动拒绝的结果（action 为 pause 时需要，恢复时直接落库） */
  deniedResults?: ToolResult[];
  /** 本 step 的 token 用量 */
  usage: UsageMetrics;
  /** 本step是否执行出错*/
  error?: Error | string;
}
```

并把第 3 行 `import type {Checkpoint, PauseInfo} from "./checkpoint.js";` 改为 `import type {Checkpoint} from "./checkpoint.js";`

- [ ] **Step 2: 改 loop-agent.ts 的 resume 单路径**

第 355-363 行，gate 改为 `nextAction`：

```typescript
    // ── 防线② 消息链核对（仅非审批恢复路径）：未配对工具调用 → 截断到该 assistant 消息之前，模型重新决策 ──
    // 审批恢复（nextAction='tool-approval'）由 applyPauseInfoRecovery 全量恢复现场，不得截断已落链的 assistant tool-call。
    if (checkpoint.nextAction !== 'tool-approval') {
      const unpaired = findUnpairedToolCalls(messages);
      if (unpaired) {
        this.log.info({ turnId: turn.id, unpaired: unpaired.unpairedCallIds }, 'unpaired tool calls, truncating chain for re-decision');
        messages.splice(unpaired.assistantIndex);
      }
    }
```

第 374-384 行，路径 A 改用平铺字段 + parentId：

```typescript
    if (checkpoint.nextAction === 'tool-approval') {
      // 路径 A：审批恢复（处理待审批调用），恢复现场进版本树
      await this.applyPauseInfoRecovery(checkpoint, decisions, context);
      context.checkpoint = await this.checkpointStore.append(turn.id, {
        parentId: checkpoint.id,
        stepIndex: checkpoint.stepIndex,
        nextAction: 'model',
        approvedTools: Object.fromEntries(context.approvedTools),
        pendingApprovalCalls: [],
        approvedCalls: [],
        deniedResults: [],
        lastMessageId: context.checkpoint.lastMessageId,
      });
    }
    // 路径 B（非审批恢复）由消息链核对 + stepIndex 续跑兜底（见上方防线②）。
```

第 396-452 行，重写 `applyPauseInfoRecovery`（入参从 `pauseInfo` 改为 `checkpoint`，删 reason 检查，`if (x && x.length)` → `if (x.length)`）：

```typescript
  /**
   * 从 checkpoint 平铺字段恢复工具调用：执行自动批准的调用、追加自动拒绝的结果、
   * 处理待审批的调用（根据 approvalDecisions 决定执行或拒绝）。
   */
  private async applyPauseInfoRecovery(checkpoint: Checkpoint, decisions: ToolCallApproval[], context: TurnContext<TToolSet>): Promise<void> {
    const decisionMap = new Map(decisions.map(d => [d.toolCallId, d]));

    // 1. 执行暂停前已自动批准的调用，结果统一持久化
    if (checkpoint.approvedCalls.length > 0) {
      const results = await this.toolExecutor.executeToolCalls(checkpoint.approvedCalls, context);
      await this.appendToolResults(results, context);
    }

    // 2. 持久化暂停前已自动拒绝的结果
    if (checkpoint.deniedResults.length > 0) {
      await this.appendToolResults(checkpoint.deniedResults, context);
    }

    // 3. 处理待审批的调用
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];

    for (const pendingCall of checkpoint.pendingApprovalCalls) {
      const decision = decisionMap.get(pendingCall.id);
      const approved = decision?.approved ?? false;
      const scope = decision?.scope ?? 'turn';
      // 回放审批决策到输出流（恢复后的新流可见完整审批链路）
      context.controller.enqueue(toolApprovalResponsePart(pendingCall, approved, { scope }));
      if (approved) {
        approvedCalls.push(pendingCall);
        // 追踪到 approvedTools，确保同一 turn 后续 step 中该工具自动放行
        context.approvedTools.set(pendingCall.name, {
          approved: true,
          approvedAt: Date.now(),
        });
        // session 级审批：持久化到 thread.metadata，跨 turn 生效
        if (scope === 'session') {
          await this.saveSessionApproval(context, pendingCall.name);
        }
      } else {
        context.controller.enqueue(toolOutputDeniedPart(pendingCall));
        deniedResults.push({
          callId: pendingCall.id, name: pendingCall.name,
          status: 'error', output: null,
          error: 'Rejected by user',
        });
      }
    }

    // 3a. 执行用户批准的调用，结果统一持久化
    if (approvedCalls.length > 0) {
      const results = await this.toolExecutor.executeToolCalls(approvedCalls, context);
      await this.appendToolResults(results, context);
    }
    // 3b. 持久化用户拒绝的结果
    if (deniedResults.length > 0) {
      await this.appendToolResults(deniedResults, context);
    }
  }
```

- [ ] **Step 3: 改 loop-agent.ts 的 runTurnLoop 两个 append 点**

第 538 行解构改为平铺字段：

```typescript
      const { action, pendingApprovalCalls, approvedCalls, deniedResults, usage: stepUsage, error } = await this.executeModelStep(step, context);
```

第 544-550 行 pause 分支（补 parentId + 平铺字段）：

```typescript
      if (action === 'pause') {
        // 暂停现场进版本树（nextAction='tool-approval'）
        context.checkpoint = await this.checkpointStore.append(turn.id, {
          parentId: context.checkpoint.id,
          stepIndex: steps,
          nextAction: 'tool-approval',
          approvedTools: Object.fromEntries(context.approvedTools),
          pendingApprovalCalls: pendingApprovalCalls ?? [],
          approvedCalls: approvedCalls ?? [],
          deniedResults: deniedResults ?? [],
          lastMessageId: context.checkpoint.lastMessageId,
        });
        await this.thread.updateTurn(turn.id, { status: 'paused', steps });
        return { status: 'paused', steps, usage };
      }
```

第 565-571 行 continue 分支：

```typescript
      // action === 'continue'：step 完成 → 追加 'model' 版本（每 step 一个版本）
      steps++;
      context.checkpoint = await this.checkpointStore.append(turn.id, {
        parentId: context.checkpoint.id,
        stepIndex: steps,
        nextAction: 'model',
        approvedTools: Object.fromEntries(context.approvedTools),
        pendingApprovalCalls: [],
        approvedCalls: [],
        deniedResults: [],
        lastMessageId: context.checkpoint.lastMessageId,
      });
```

- [ ] **Step 4: 改 loop-agent.ts 的 executeModelStep pause 构造**

第 630-641 行替换为（删 PauseInfo 构造）：

```typescript
    if (pausedCalls.length > 0) {
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { action: 'pause', pendingApprovalCalls: pausedCalls, approvedCalls, deniedResults, usage };
    }
```

- [ ] **Step 5: 改 loop-agent.ts 的终态 append 两处**

第 480-486 行（failed）与第 500-506 行（completed/aborted）的 append patch，补 parentId + 平铺空数组：

```typescript
      await this.checkpointStore.append(turn.id, {
        parentId: context.checkpoint.id,
        stepIndex: loopResult.steps,
        nextAction: 'end',
        approvedTools: Object.fromEntries(context.approvedTools),
        pendingApprovalCalls: [],
        approvedCalls: [],
        deniedResults: [],
        lastMessageId: context.checkpoint.lastMessageId,
      });
```

（两处结构一致，均为 `nextAction: 'end'`。）

- [ ] **Step 6: 删除 loop-agent.ts 中残留的 PauseInfo 导入/引用**

若 `loop-agent.ts` 顶部从 `./loop-agent-options.js` 或 `./checkpoint.js` import 了 `PauseInfo`，删除该导入名。用 Grep 确认无残留 `pauseInfo` / `PauseInfo` 引用。

- [ ] **Step 7: 运行 core 全量测试确认恢复编译**

Run: `pnpm --filter @vico/core test`
Expected: PASS（checkpoint/memory-store/loop-agent 全部测试绿）

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent/loop-agent.ts packages/core/src/agent/loop-agent-options.ts
git commit -m "feat(core): loop-agent resume 并单路径，append 带 parentId + 平铺字段"
```

---

### Task 3: libsql 适配器

**Files:**
- Modify: `packages/libsql-adapter/src/schema.ts`
- Modify: `packages/libsql-adapter/src/migrate.ts`
- Modify: `packages/libsql-adapter/src/libsql-checkpoint-store.ts`
- Modify: `packages/libsql-adapter/src/libsql-checkpoint-store.test.ts`

**Interfaces:**
- Consumes: Task 1 的新 `Checkpoint`/`CheckpointAppendPatch`/`createCheckpoint`
- Produces: 新 `vico_checkpoints` 表（id PK + parent_id + UNIQUE(turn_id,version)）、`getById`、DROP 重建守卫

- [ ] **Step 1: 更新 libsql-checkpoint-store.test.ts（先红）**

`patch()` 扩为 8 字段；删除 `pauseInfo` 断言；新增 `getById` 与 fork parentId 断言：

```typescript
import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureTables } from './migrate.js';
import { LibSqlCheckpointStore } from './libsql-checkpoint-store.js';
import * as schema from './schema.js';
import type { CheckpointAppendPatch } from '@vico/core';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { parentId: null, stepIndex: 1, nextAction: 'model', approvedTools: {}, pendingApprovalCalls: [], approvedCalls: [], deniedResults: [], lastMessageId: null, ...overrides };
}

async function makeStore() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await ensureTables(db as any);
  return new LibSqlCheckpointStore(db as any);
}

describe('LibSqlCheckpointStore（版本树）', () => {
  it('create + append 版本递增、getLatest 取最新', async () => {
    const store = await makeStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 1, nextAction: 'end' }));
    expect(v2.id).toBeTruthy();
    expect(v2.parentId).toBe(v1.id);
    expect((await store.getLatest('turn-1'))?.version).toBe(2);
    expect((await store.getLatest('turn-1'))?.nextAction).toBe('end');
  });

  it('listVersions 升序 + getVersion/getById 定位', async () => {
    const store = await makeStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 2 }));
    expect((await store.listVersions('turn-1')).map((v) => v.version)).toEqual([1, 2]);
    expect((await store.getVersion('turn-1', 2))?.stepIndex).toBe(2);
    expect((await store.getById(v2.id))?.stepIndex).toBe(2);
  });

  it('fork 复制快照到新 turn 初始版本，parentId 指向源版本 id', async () => {
    const store = await makeStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 4, nextAction: 'tool-approval' }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked?.version).toBe(1);
    expect(forked?.stepIndex).toBe(4);
    expect(forked?.nextAction).toBe('tool-approval');
    expect(forked?.parentId).toBe(v2.id);
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除 + deleteByTurn 清链', async () => {
    const store = await makeStore();
    const a = await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch({ parentId: a.id }));
    await store.create('turn-new', 'thread-1');
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

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @vico/libsql-adapter test`
Expected: FAIL（类型错误 + `vico_checkpoints` 无 `id`/`parent_id` 列 → INSERT 失败）

- [ ] **Step 3: 改 schema.ts 的 checkpoints 表**

`packages/libsql-adapter/src/schema.ts` 第 2 行 import 加 `uniqueIndex`；第 42-53 行替换：

```typescript
/** turn 执行状态检查点 — 版本树：id 单列主键 + UNIQUE(turn_id, version)，一行一个版本快照，parent_id 表达血缘 */
export const checkpoints = sqliteTable('vico_checkpoints', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  turnId: text('turn_id').notNull(),
  threadId: text('thread_id').notNull(),
  version: integer('version').notNull(),
  stepIndex: integer('step_index').notNull(),
  nextAction: text('next_action').notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  uniqTurnVersion: uniqueIndex('uniq_checkpoints_turn_version').on(t.turnId, t.version),
}));
```

- [ ] **Step 4: 改 migrate.ts 的 DROP 守卫与 CREATE**

第 76-98 行替换：

```typescript
  // 迁移检测：旧版 vico_checkpoints 为 (turn_id, version) 复合主键、无 id/parent_id 列。
  // SQLite 无法 ALTER 主键，检测到旧结构时 DROP 重建为版本树（旧链数据开发期丢弃）。
  const ckptCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_checkpoints')
  `);
  const ckptColNames = ckptCols.map((r) => r[0]);
  if (ckptColNames.length > 0 && (!ckptColNames.includes('id') || !ckptColNames.includes('parent_id'))) {
    await db.run(sql`DROP TABLE vico_checkpoints`);
  }

  // 检查点版本树
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      turn_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      next_action TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (turn_id, version)
    )
  `);
```

- [ ] **Step 5: 改 libsql-checkpoint-store.ts**

顶部加 `import { randomUUID } from 'node:crypto';`。`append`（第 25-41 行）改为：

```typescript
  /** 追加一个版本：version = max+1，生成新 uuid id，parentId 由 patch 显式指定 */
  async append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint> {
    const latest = await this.getLatest(turnId);
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      parentId: patch.parentId,
      turnId,
      threadId: latest?.threadId ?? '',
      version: (latest?.version ?? 0) + 1,
      stepIndex: patch.stepIndex,
      nextAction: patch.nextAction,
      approvedTools: patch.approvedTools,
      pendingApprovalCalls: patch.pendingApprovalCalls,
      approvedCalls: patch.approvedCalls,
      deniedResults: patch.deniedResults,
      lastMessageId: patch.lastMessageId,
      schemaVersion: CHECKPOINT_CURRENT_VERSION,
      createdAt: Date.now(),
    };
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }
```

`getVersion` 后新增 `getById`：

```typescript
  /** 按 id 读版本（父引用解析、指定叶恢复） */
  async getById(id: string): Promise<Checkpoint | undefined> {
    const row = await this.db.select().from(checkpoints).where(eq(checkpoints.id, id)).get();
    return row ? this.migrate(JSON.parse(row.snapshot)) : undefined;
  }
```

`fork`（第 76-87 行）改为复制平铺字段 + parentId：

```typescript
  /** 从源版本复制快照到新 turn 初始版本，parentId = 源版本 id（跨 turn 边） */
  async fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined> {
    const source = await this.getVersion(sourceTurnId, version);
    if (!source) return undefined;
    const checkpoint = createCheckpoint(newTurnId, newThreadId);
    checkpoint.parentId = source.id;
    checkpoint.stepIndex = source.stepIndex;
    checkpoint.nextAction = source.nextAction;
    checkpoint.approvedTools = source.approvedTools;
    checkpoint.pendingApprovalCalls = source.pendingApprovalCalls;
    checkpoint.approvedCalls = source.approvedCalls;
    checkpoint.deniedResults = source.deniedResults;
    checkpoint.lastMessageId = source.lastMessageId;
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }
```

`toRow`（第 109-120 行）加 id/parentId：

```typescript
  /** Checkpoint → 行（snapshot 存完整 JSON） */
  private toRow(ckpt: Checkpoint) {
    return {
      id: ckpt.id,
      parentId: ckpt.parentId,
      turnId: ckpt.turnId,
      threadId: ckpt.threadId,
      version: ckpt.version,
      stepIndex: ckpt.stepIndex,
      nextAction: ckpt.nextAction,
      snapshot: JSON.stringify(ckpt),
      createdAt: ckpt.createdAt,
    };
  }
```

- [ ] **Step 6: 运行 libsql 测试确认通过**

Run: `pnpm --filter @vico/libsql-adapter test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/libsql-adapter/src/schema.ts packages/libsql-adapter/src/migrate.ts packages/libsql-adapter/src/libsql-checkpoint-store.ts packages/libsql-adapter/src/libsql-checkpoint-store.test.ts
git commit -m "feat(libsql): vico_checkpoints 迁为 id+parent_id 版本树，DROP 重建"
```

---

### Task 4: mysql 适配器

**Files:**
- Modify: `packages/mysql-adapter/src/schema.ts`
- Modify: `packages/mysql-adapter/src/migrate.ts`
- Modify: `packages/mysql-adapter/src/mysql-checkpoint-store.ts`

**Interfaces:**
- Consumes: Task 1 的新 `Checkpoint`/`CheckpointAppendPatch`/`createCheckpoint`
- Produces: 新 `vico_checkpoints` 表、`getById`、DROP 重建守卫（镜像 libsql 改动，无独立测试文件，用 `build` typecheck 验证）

- [ ] **Step 1: 改 schema.ts 的 checkpoints 表**

`packages/mysql-adapter/src/schema.ts` 第 2 行 import 加 `uniqueIndex`；第 41-52 行替换：

```typescript
/** turn 执行状态检查点 — 版本树：id 单列主键 + UNIQUE(turn_id, version)，parent_id 表达血缘 */
export const checkpoints = mysqlTable('vico_checkpoints', {
  id: varchar('id', { length: 36 }).primaryKey(),
  parentId: varchar('parent_id', { length: 36 }),
  turnId: varchar('turn_id', { length: 36 }).notNull(),
  threadId: varchar('thread_id', { length: 36 }).notNull(),
  version: int('version').notNull(),
  stepIndex: int('step_index').notNull(),
  nextAction: varchar('next_action', { length: 20 }).notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => ({
  uniqTurnVersion: uniqueIndex('uniq_checkpoints_turn_version').on(t.turnId, t.version),
}));
```

- [ ] **Step 2: 改 migrate.ts 的 DROP 守卫与 CREATE**

第 70-94 行替换（INFORMATION_SCHEMA 检测 `id`/`parent_id`）：

```typescript
  // 迁移检测：旧版 vico_checkpoints 为 (turn_id, version) 复合主键、无 id/parent_id 列。
  // MySQL 无法 ALTER 主键，检测到旧结构时 DROP 重建为版本树（旧链数据开发期丢弃）。
  const ckptCols = await db.execute(sql`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vico_checkpoints'
  `);
  const ckptColNames = (ckptCols[0] as unknown as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);
  if (ckptColNames.length > 0 && (!ckptColNames.includes('id') || !ckptColNames.includes('parent_id'))) {
    await db.execute(sql`DROP TABLE vico_checkpoints`);
  }

  // Checkpoints table — 版本树：id 单列主键 + UNIQUE(turn_id, version)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      id VARCHAR(36) PRIMARY KEY,
      parent_id VARCHAR(36),
      turn_id VARCHAR(36) NOT NULL,
      thread_id VARCHAR(36) NOT NULL,
      version INT NOT NULL,
      step_index INT NOT NULL,
      next_action VARCHAR(20) NOT NULL,
      snapshot TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE KEY uq_checkpoints_turn_version (turn_id, version),
      KEY idx_thread_id (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
```

- [ ] **Step 3: 完整替换 mysql-checkpoint-store.ts**

`packages/mysql-adapter/src/mysql-checkpoint-store.ts` 完整替换为：

```typescript
// @vico/mysql-adapter — MySQL CheckpointStore implementation（版本树，append-only）
import { eq, sql, desc } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { Checkpoint, CheckpointAppendPatch, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from '@vico/core';
import { checkpoints } from './schema.js';
import type * as schema from './schema.js';
import { randomUUID } from 'node:crypto';

/** MySQL 版本树 {@link CheckpointStore}，语义与 LibSql 版一致 */
export class MysqlCheckpointStore implements CheckpointStore {
  constructor(private db: MySql2Database<typeof schema>) {}

  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  /** 追加一个版本：version = max+1，生成新 uuid id，parentId 由 patch 显式指定 */
  async append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint> {
    const latest = await this.getLatest(turnId);
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      parentId: patch.parentId,
      turnId,
      threadId: latest?.threadId ?? '',
      version: (latest?.version ?? 0) + 1,
      stepIndex: patch.stepIndex,
      nextAction: patch.nextAction,
      approvedTools: patch.approvedTools,
      pendingApprovalCalls: patch.pendingApprovalCalls,
      approvedCalls: patch.approvedCalls,
      deniedResults: patch.deniedResults,
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

  /** 按 id 读版本（父引用解析、指定叶恢复） */
  async getById(id: string): Promise<Checkpoint | undefined> {
    const rows = await this.db.select().from(checkpoints).where(eq(checkpoints.id, id)).limit(1);
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

  /** 从源版本复制快照到新 turn 初始版本，parentId = 源版本 id（跨 turn 边） */
  async fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined> {
    const source = await this.getVersion(sourceTurnId, version);
    if (!source) return undefined;
    const checkpoint = createCheckpoint(newTurnId, newThreadId);
    checkpoint.parentId = source.id;
    checkpoint.stepIndex = source.stepIndex;
    checkpoint.nextAction = source.nextAction;
    checkpoint.approvedTools = source.approvedTools;
    checkpoint.pendingApprovalCalls = source.pendingApprovalCalls;
    checkpoint.approvedCalls = source.approvedCalls;
    checkpoint.deniedResults = source.deniedResults;
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

  /** Checkpoint → 行（snapshot 存完整 JSON） */
  private toRow(ckpt: Checkpoint) {
    return {
      id: ckpt.id,
      parentId: ckpt.parentId,
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

- [ ] **Step 4: typecheck 验证**

Run: `pnpm --filter @vico/mysql-adapter build`
Expected: 编译通过，无类型错误

- [ ] **Step 5: Commit**

```bash
git add packages/mysql-adapter/src/schema.ts packages/mysql-adapter/src/migrate.ts packages/mysql-adapter/src/mysql-checkpoint-store.ts
git commit -m "feat(mysql): vico_checkpoints 迁为 id+parent_id 版本树，DROP 重建"
```

---

### Task 5: workspace 构建回归

**Files:**
- 全仓

**Interfaces:**
- Consumes: Task 1-4 全部改动

- [ ] **Step 1: 全量构建**

Run: `pnpm build`
Expected: 全部包编译通过（含 server 与 web）

- [ ] **Step 2: 回归测试**

Run: `pnpm --filter @vico/core test && pnpm --filter @vico/libsql-adapter test`
Expected: 全部 PASS

- [ ] **Step 3: 确认无 PauseInfo 残留**

Run Grep（pattern `pauseInfo|PauseInfo|pendingToolCalls`，path `packages`，output `content`）
Expected: 仅剩注释/说明文本（`docs/superpowers/specs/2026-09-01-checkpoint-version-tree-design.md` 允许），无代码引用

- [ ] **Step 4: Commit（如本轮有未提交改动）**

```bash
git add -A
git commit -m "chore: checkpoint 版本树升级回归验证"
```
