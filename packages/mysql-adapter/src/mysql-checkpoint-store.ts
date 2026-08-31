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
