// @vico/libsql-adapter — LibSQL CheckpointStore implementation（版本树，append-only）
import { randomUUID } from 'node:crypto';
import { eq, sql, desc } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Checkpoint, CheckpointAppendPatch, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from '@vico/core';
import { checkpoints } from './schema.js';
import type * as schema from './schema.js';

/**
 * LibSQL 版本树 {@link CheckpointStore}。
 * 一行一个版本快照（单列主键 id + UNIQUE(turn_id,version)），snapshot 存完整 Checkpoint JSON，
 * step_index / next_action 平铺为索引列，parent_id 表达血缘。读时懒迁移。
 */
export class LibSqlCheckpointStore implements CheckpointStore {
  constructor(private db: LibSQLDatabase<typeof schema>) {}

  /** 创建初始版本（version=1、stepIndex=0、nextAction=model） */
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

  /** 按 id 读版本（父引用解析、指定叶恢复） */
  async getById(id: string): Promise<Checkpoint | undefined> {
    const row = await this.db.select().from(checkpoints).where(eq(checkpoints.id, id)).get();
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
