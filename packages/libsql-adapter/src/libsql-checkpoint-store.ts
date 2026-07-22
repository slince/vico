// @vico/libsql-adapter — LibSQL CheckpointStore implementation
import { eq, lt } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Checkpoint, CheckpointStore } from '@vico/core';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations } from '@vico/core';
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

  /**
   * Save a checkpoint for a turn.
   * On first save, creates a full default Checkpoint and applies the patch.
   * On subsequent saves, merges the patch into the existing checkpoint,
   * preserving array fields unless the patch provides new values.
   * Always updates version to {@link CHECKPOINT_CURRENT_VERSION} and updatedAt to now.
   */
  async save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
    const existing = await this.getByTurn(turnId);
    const now = Date.now();

    if (existing) {
      // Merge patch into existing, preserving arrays unless explicitly replaced
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

    // First save: create a default checkpoint then apply the patch on top
    const created: Checkpoint = {
      id: `ckpt-${turnId}`,
      turnId,
      threadId,
      version: CHECKPOINT_CURRENT_VERSION,
      stepIndex: 0,
      toolApprovalState: {},
      pauseInfo: null,

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
