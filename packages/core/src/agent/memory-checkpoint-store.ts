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
