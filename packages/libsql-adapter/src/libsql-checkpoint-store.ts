// @vico/libsql-adapter — LibSQL CheckpointStore implementation
import { eq, lt } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Checkpoint, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from '@vico/core';
import { checkpoints } from './schema.js';

/**
 * LibSQL-backed {@link CheckpointStore} implementation using Drizzle ORM.
 * Stores complete checkpoint snapshots as JSON in the `snapshot` column,
 * with frequently queried fields denormalized to dedicated columns
 * for efficient filtering (turnId, threadId, paused, createdAt).
 *
 * Supports lazy version migration via {@link checkpointMigrations} on read.
 */
export class LibSqlCheckpointStore implements CheckpointStore {
  constructor(private db: LibSQLDatabase) {}

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

  /** Retrieve a single checkpoint by turnId, with lazy migration. */
  async getByTurn(turnId: string): Promise<Checkpoint | undefined> {
    const row = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turnId))
      .get();
    if (!row) return undefined;

    let snapshot = JSON.parse(row.snapshot) as Record<string, unknown>;
    // Apply lazy migrations until the snapshot reaches the current version
    while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.version as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }

  /** List all checkpoints belonging to the given threadId. */
  async listByThread(threadId: string): Promise<Checkpoint[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.threadId, threadId))
      .all();

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

  /** Delete the checkpoint for the given turnId. */
  async deleteByTurn(turnId: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId));
  }

  /**
   * Purge expired checkpoints.
   * Returns the turnIds of any purged checkpoints that were in a paused state,
   * so callers can clean up associated resources (e.g. pause locks).
   */
  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;

    // Collect paused turn IDs before deletion
    const expired = await this.db
      .select({ turnId: checkpoints.turnId, paused: checkpoints.paused })
      .from(checkpoints)
      .where(lt(checkpoints.createdAt, cutoff))
      .all();

    await this.db.delete(checkpoints).where(lt(checkpoints.createdAt, cutoff));

    return expired.filter((r) => r.paused === 1).map((r) => r.turnId);
  }

  /**
   * Map a {@link Checkpoint} to column values for insert/update.
   * - `paused`: 1 if pauseInfo is set, 0 otherwise
   * - `pendingTool`: JSON-serialized pendingToolCall, or null
   * - `snapshot`: JSON-serialized full checkpoint for recovery and migration
   */
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
