import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCheckpointPurge } from '../../checkpoint-purge.js';
import type { CheckpointStore } from '@vico/core';

describe('startCheckpointPurge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('启动时立即执行一次 purgeExpired', async () => {
    const purgeExpired = vi.fn().mockResolvedValue([]);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const stop = startCheckpointPurge(store, 30 * 24 * 60 * 60 * 1000, { info: () => {}, error: () => {} } as any);
    await vi.waitFor(() => expect(purgeExpired).toHaveBeenCalledTimes(1));
    stop();
  });

  it('周期触发 purgeExpired（每小时一次）', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockResolvedValue(['turn-1']);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const stop = startCheckpointPurge(store, 30 * 24 * 60 * 60 * 1000, { info: () => {}, error: () => {} } as any);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2); // 启动 1 次 + 定时 1 次
    stop();
  });

  it('purge 抛错不中断定时器', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockRejectedValueOnce(new Error('db down'));
    const store = { purgeExpired } as unknown as CheckpointStore;
    const stop = startCheckpointPurge(store, 1000, { info: () => {}, error: () => {} } as any);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    stop();
  });
});
