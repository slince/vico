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
