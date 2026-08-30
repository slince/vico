import { describe, expect, it } from 'vitest';
import { MemoryCheckpointStore } from './memory-checkpoint-store.js';
import type { Checkpoint, CheckpointAppendPatch } from './checkpoint.js';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { stepIndex: 1, nextAction: 'model', approvedTools: {}, pauseInfo: null, lastMessageId: null, ...overrides };
}

describe('MemoryCheckpointStore（多版本链）', () => {
  it('create 生成初始版本（version=1、stepIndex=0、nextAction=model）', async () => {
    const store = new MemoryCheckpointStore();
    const ckpt = await store.create('turn-1', 'thread-1');
    expect(ckpt.version).toBe(1);
    expect(ckpt.stepIndex).toBe(0);
    expect(ckpt.nextAction).toBe('model');
  });

  it('append 版本号递增，快照字段由 patch 全量覆盖', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ stepIndex: 1, nextAction: 'tool-approval', pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 0 } }));
    const v3 = await store.append('turn-1', patch({ stepIndex: 2, nextAction: 'end' }));
    expect(v2.version).toBe(2);
    expect(v2.nextAction).toBe('tool-approval');
    expect(v3.version).toBe(3);
    expect(v3.pauseInfo).toBeNull(); // patch 显式覆盖，不继承 v2 的 pauseInfo
  });

  it('getLatest 取最新版本', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 2, nextAction: 'end' }));
    const latest = await store.getLatest('turn-1');
    expect(latest?.version).toBe(2);
    expect(latest?.nextAction).toBe('end');
  });

  it('getVersion 读指定版本', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 5, nextAction: 'tool-approval' }));
    const v2 = await store.getVersion('turn-1', 2);
    expect(v2?.stepIndex).toBe(5);
    expect(await store.getVersion('turn-1', 99)).toBeUndefined();
  });

  it('listVersions 按版本号升序返回', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch());
    await store.append('turn-1', patch());
    const versions = await store.listVersions('turn-1');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('fork 从源版本复制快照到新 turn 初始版本，原 turn 链不变', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 3, nextAction: 'tool-approval', pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 3 } }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked).toBeDefined();
    expect(forked!.version).toBe(1);        // 新 turn 初始版本
    expect(forked!.threadId).toBe('thread-2');
    expect(forked!.stepIndex).toBe(3);       // 继承分叉点
    expect(forked!.nextAction).toBe('tool-approval');
    expect(forked!.pauseInfo?.pausedAtStep).toBe(3);
    // 原 turn 链不变
    expect((await store.listVersions('turn-1')).map((v) => v.version)).toEqual([1, 2]);
    // 源版本不存在 → undefined
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除（一个 turn 的所有版本一起删）', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch());
    await store.create('turn-new', 'thread-1');
    // 把 turn-old 的 created_at 调回过去（copy-on-read 后返回值是拷贝，需白盒直改存储对象）
    const rawStore = store as unknown as { store: Map<string, Checkpoint> };
    for (const ckpt of rawStore.store.values()) {
      if (ckpt.turnId === 'turn-old') ckpt.createdAt = Date.now() - 100_000;
    }
    const purged = await store.purgeExpired(10_000);
    expect(purged).toEqual(['turn-old']);
    expect(await store.listVersions('turn-old')).toEqual([]); // 整链消失，无残留版本
    expect((await store.listVersions('turn-new')).length).toBe(1); // 活跃 turn 不受影响
  });

  it('deleteByTurn 删除整个版本链', async () => {
    const store = new MemoryCheckpointStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch());
    await store.deleteByTurn('turn-1');
    expect(await store.getLatest('turn-1')).toBeUndefined();
  });
});
