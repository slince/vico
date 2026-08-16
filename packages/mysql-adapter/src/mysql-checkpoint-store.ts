// @vico/mysql-adapter — MySQL CheckpointStore implementation
import { eq, lt } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { Checkpoint, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from '@vico/core';
import { checkpoints } from './schema.js';

/**
 * MySQL-backed {@link CheckpointStore} implementation using Drizzle ORM.
 * Stores complete checkpoint snapshots as JSON in the `snapshot` column,
 * with frequently queried fields denormalized to dedicated columns.
 */
export class MysqlCheckpointStore implements CheckpointStore {
  constructor(private db: MySql2Database) {}

  /** 创建新 checkpoint（turn 开始时调用，返回内存对象） */
  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    await this.db.insert(checkpoints).values(this.toRow(checkpoint));
    return checkpoint;
  }

  /**
   * 持久化 checkpoint 对象（全量覆盖）。
   * 内部统一维护 version 与 updatedAt，调用方只需 mutate 业务字段。
   * 序列化（toRow）在首次 await 前同步执行，保证并发下读到对象最新状态。
   */
  async update(checkpoint: Checkpoint): Promise<void> {
    checkpoint.version = CHECKPOINT_CURRENT_VERSION;
    checkpoint.updatedAt = Date.now();
    const row = this.toRow(checkpoint);
    await this.db
      .update(checkpoints)
      .set(row)
      .where(eq(checkpoints.turnId, checkpoint.turnId));
  }

  async getByTurn(turnId: string): Promise<Checkpoint | undefined> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turnId))
      .limit(1);
    if (rows.length === 0) return undefined;

    let snapshot = JSON.parse(rows[0].snapshot) as Record<string, unknown>;
    while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.version as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }

  async listByThread(threadId: string): Promise<Checkpoint[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.threadId, threadId));

    return rows.map((r) => {
      let snapshot = JSON.parse(r.snapshot) as Record<string, unknown>;
      while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
        const migrateFn = checkpointMigrations[snapshot.version as number];
        if (!migrateFn) break;
        snapshot = migrateFn(snapshot);
      }
      return snapshot as unknown as Checkpoint;
    });
  }

  async deleteByTurn(turnId: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId));
  }

  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;

    const expired = await this.db
      .select({ turnId: checkpoints.turnId, paused: checkpoints.paused })
      .from(checkpoints)
      .where(lt(checkpoints.createdAt, cutoff));

    await this.db.delete(checkpoints).where(lt(checkpoints.createdAt, cutoff));

    return expired.filter((r) => r.paused === 1).map((r) => r.turnId);
  }

  private toRow(ckpt: Checkpoint) {
    return {
      id: ckpt.id,
      turnId: ckpt.turnId,
      threadId: ckpt.threadId,
      version: ckpt.version,
      stepIndex: ckpt.stepIndex,
      paused: ckpt.pauseInfo !== null ? 1 : 0,
      pendingTool: ckpt.pendingToolCall ? JSON.stringify(ckpt.pendingToolCall) : null,
      snapshot: JSON.stringify(ckpt),
      createdAt: ckpt.createdAt,
      updatedAt: ckpt.updatedAt,
    };
  }
}
