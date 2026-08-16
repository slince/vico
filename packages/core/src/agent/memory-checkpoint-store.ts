// @vico/core — In-memory CheckpointStore implementation
import type { Checkpoint, CheckpointStore } from './checkpoint.js';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, createCheckpoint } from './checkpoint.js';

/**
 * In-memory implementation of {@link CheckpointStore}.
 * Stores checkpoints in a Map keyed by turnId.
 * Supports lazy version migration on read.
 */
export class MemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, Checkpoint>();

  /** 创建新 checkpoint（turn 开始时调用，返回内存对象） */
  async create(turnId: string, threadId: string): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(turnId, threadId);
    this.store.set(turnId, checkpoint);
    return checkpoint;
  }

  /**
   * 持久化 checkpoint 对象（全量覆盖）。
   * 内部统一维护 version 与 updatedAt，调用方只需 mutate 业务字段。
   */
  async update(checkpoint: Checkpoint): Promise<void> {
    checkpoint.version = CHECKPOINT_CURRENT_VERSION;
    checkpoint.updatedAt = Date.now();
    this.store.set(checkpoint.turnId, checkpoint);
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
