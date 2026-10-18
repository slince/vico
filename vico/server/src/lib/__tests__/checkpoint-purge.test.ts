import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointPurge } from '../checkpoint-purge.js';
import type { CheckpointStore } from '@vico/checkpoint';

describe('CheckpointPurge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('启动时立即执行一次 purgeExpired', async () => {
    const purgeExpired = vi.fn().mockResolvedValue([]);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const purge = new CheckpointPurge(store, 30 * 24 * 60 * 60 * 1000);
    purge.start();
    await vi.waitFor(() => expect(purgeExpired).toHaveBeenCalledTimes(1));
    purge.stop();
  });

  it('周期触发 purgeExpired（每小时一次）', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockResolvedValue(['turn-1']);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const purge = new CheckpointPurge(store, 30 * 24 * 60 * 60 * 1000);
    purge.start();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2); // 启动 1 次 + 定时 1 次
    purge.stop();
  });

  it('purge 抛错不中断定时器', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockRejectedValueOnce(new Error('db down'));
    const store = { purgeExpired } as unknown as CheckpointStore;
    const purge = new CheckpointPurge(store, 1000);
    purge.start();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    purge.stop();
  });
});
