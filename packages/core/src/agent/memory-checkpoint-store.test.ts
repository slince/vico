import { describe, expect, it } from 'vitest';
import { MemoryCheckpointStore } from './memory-checkpoint-store.js';
import type { Checkpoint, CheckpointAppendPatch } from './checkpoint.js';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { parentId: null, stepIndex: 1, nextAction: 'model', approvedTools: {}, pendingApprovalCalls: [], approvedCalls: [], deniedResults: [], lastMessageId: null, ...overrides };
}

describe('MemoryCheckpointStore（版本树）', () => {
  it('create 生成初始版本（id 非空、version=1、nextAction=model）', async () => {
    const store = new MemoryCheckpointStore();
    const ckpt = await store.create('turn-1', 'thread-1');
    expect(ckpt.id).toBeTruthy();
    expect(ckpt.parentId).toBeNull();
    expect(ckpt.version).toBe(1);
    expect(ckpt.stepIndex).toBe(0);
    expect(ckpt.nextAction).toBe('model');
  });

  it('append 生成 uuid id 并采用 patch.parentId，version 递增', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 1, nextAction: 'tool-approval', pendingApprovalCalls: [{ id: 'call-1', name: 'webSearch', args: {} }] }));
    const v3 = await store.append('turn-1', patch({ parentId: v2.id, stepIndex: 2, nextAction: 'end' }));
    expect(v2.id).toBeTruthy();
    expect(v2.parentId).toBe(v1.id);
    expect(v2.version).toBe(2);
    expect(v2.nextAction).toBe('tool-approval');
    expect(v2.pendingApprovalCalls.length).toBe(1);
    expect(v3.version).toBe(3);
    expect(v3.pendingApprovalCalls).toEqual([]); // patch 显式覆盖，不继承 v2
  });

  it('getLatest / getVersion / getById 读取', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 2, nextAction: 'end' }));
    expect((await store.getLatest('turn-1'))?.version).toBe(2);
    expect((await store.getVersion('turn-1', 1))?.id).toBe(v1.id);
    expect((await store.getById(v2.id))?.nextAction).toBe('end');
    expect(await store.getById('nope')).toBeUndefined();
  });

  it('listVersions 按版本号升序返回', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ parentId: v1.id }));
    await store.append('turn-1', patch({ parentId: v1.id }));
    const versions = await store.listVersions('turn-1');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('fork 新 turn v1 的 parentId 指向源版本 id，原链不变', async () => {
    const store = new MemoryCheckpointStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 3, nextAction: 'tool-approval' }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked).toBeDefined();
    expect(forked!.version).toBe(1);
    expect(forked!.threadId).toBe('thread-2');
    expect(forked!.stepIndex).toBe(3);
    expect(forked!.nextAction).toBe('tool-approval');
    expect(forked!.parentId).toBe(v2.id); // 跨 turn 父引用
    expect((await store.listVersions('turn-1')).map((v) => v.version)).toEqual([1, 2]);
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除 + deleteByTurn 清链', async () => {
    const store = new MemoryCheckpointStore();
    const a = await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch({ parentId: a.id }));
    await store.create('turn-new', 'thread-1');
    const rawStore = store as unknown as { store: Map<string, Checkpoint> };
    for (const ckpt of rawStore.store.values()) {
      if (ckpt.turnId === 'turn-old') ckpt.createdAt = Date.now() - 100_000;
    }
    const purged = await store.purgeExpired(10_000);
    expect(purged).toEqual(['turn-old']);
    expect(await store.listVersions('turn-old')).toEqual([]);
    expect((await store.listVersions('turn-new')).length).toBe(1);
    await store.deleteByTurn('turn-new');
    expect(await store.getLatest('turn-new')).toBeUndefined();
  });
});
