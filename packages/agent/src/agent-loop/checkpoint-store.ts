// @vico/agent — In-memory CheckpointStore implementation
import type { Checkpoint, CheckpointStore } from './checkpoint.js';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations } from './checkpoint.js';

/**
 * In-memory implementation of {@link CheckpointStore}.
 * Stores checkpoints in a Map keyed by turnId.
 * Supports lazy version migration on read.
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, Checkpoint>();

  /**
   * Save a checkpoint for a turn.
   * On first save, creates a full default Checkpoint and applies the patch.
   * On subsequent saves, merges the patch into the existing checkpoint,
   * preserving array fields unless the patch provides new values.
   * Always updates version to {@link CHECKPOINT_CURRENT_VERSION} and updatedAt to now.
   */
  async save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
    const existing = this.store.get(turnId);
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
      this.store.set(turnId, merged);
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
      messageCount: 0,
      lastMessageId: null,
      completedToolCallIds: [],
      completedToolResults: [],
      pendingToolCall: null,
      createdAt: now,
      updatedAt: now,
      ...patch,
    };
    this.store.set(turnId, created);
    return created;
  }

  /** Retrieve a single checkpoint by turnId, with lazy migration. */
  async getByTurn(turnId: string): Promise<Checkpoint | undefined> {
    const ckpt = this.store.get(turnId);
    if (!ckpt) return undefined;
    return this.migrate(ckpt);
  }

  /** List all checkpoints belonging to the given threadId. */
  async listByThread(threadId: string): Promise<Checkpoint[]> {
    const results: Checkpoint[] = [];
    for (const ckpt of this.store.values()) {
      if (ckpt.threadId === threadId) {
        results.push(this.migrate(ckpt));
      }
    }
    return results;
  }

  /** Delete the checkpoint for the given turnId. */
  async deleteByTurn(turnId: string): Promise<void> {
    this.store.delete(turnId);
  }

  /**
   * Purge expired checkpoints.
   * Returns the turnIds of any purged checkpoints that were in a paused state,
   * so callers can clean up associated resources (e.g. pause locks).
   */
  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expiredTurnIds: string[] = [];
    for (const [turnId, ckpt] of this.store.entries()) {
      if (ckpt.createdAt < cutoff) {
        if (ckpt.pauseInfo !== null) {
          expiredTurnIds.push(turnId);
        }
        this.store.delete(turnId);
      }
    }
    return expiredTurnIds;
  }

  /**
   * Lazy version migration: applies all pending migrations
   * ({@link checkpointMigrations}) until the checkpoint reaches
   * {@link CHECKPOINT_CURRENT_VERSION}.
   */
  private migrate(ckpt: Checkpoint): Checkpoint {
    let snapshot = ckpt as unknown as Record<string, unknown>;
    while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.version as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }
}
