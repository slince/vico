// @vico/mysql-adapter — MySQL CheckpointStore implementation
import { eq, lt } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { Checkpoint, CheckpointStore } from '@vico/agent';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations } from '@vico/agent';
import { checkpoints } from './schema.js';

/**
 * MySQL-backed {@link CheckpointStore} implementation using Drizzle ORM.
 * Stores complete checkpoint snapshots as JSON in the `snapshot` column,
 * with frequently queried fields denormalized to dedicated columns.
 */
export class MysqlCheckpointStore implements CheckpointStore {
  constructor(private db: MySql2Database) {}

  async save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
    const existing = await this.getByTurn(turnId);
    const now = Date.now();

    if (existing) {
      const merged: Checkpoint = {
        ...existing,
        ...patch,
        version: CHECKPOINT_CURRENT_VERSION,
        updatedAt: now,
        completedToolCallIds: patch.completedToolCallIds ?? existing.completedToolCallIds,
        completedToolResults: patch.completedToolResults ?? existing.completedToolResults,
      };

      const row = this.toRow(merged);
      await this.db
        .update(checkpoints)
        .set(row)
        .where(eq(checkpoints.turnId, turnId));
      return merged;
    }

    const created: Checkpoint = {
      id: `ckpt-${turnId}`,
      turnId,
      threadId,
      version: CHECKPOINT_CURRENT_VERSION,
      stepIndex: 0,
      toolApprovalState: {},
      pauseInfo: null,
      messageCount: 0,

      completedToolCallIds: [],
      completedToolResults: [],
      pendingToolCall: null,
      createdAt: now,
      updatedAt: now,
      ...patch,
    };

    const row = this.toRow(created);
    await this.db.insert(checkpoints).values(row);
    return created;
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
