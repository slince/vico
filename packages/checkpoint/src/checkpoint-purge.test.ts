import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { CheckpointPurge } from './checkpoint-purge.js';
import type { CheckpointStore } from './checkpoint.js';

/** 最小 logger mock（pino Logger 结构），仅关心调用次数与参数 */
function mockLogger(): Logger {
  return { info: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('CheckpointPurge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('启动时立即执行一次 purgeExpired', async () => {
    const purgeExpired = vi.fn().mockResolvedValue([]);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const logger = mockLogger();
    const purge = new CheckpointPurge(store, 30 * 24 * 60 * 60 * 1000, logger);
    purge.start();
    await vi.waitFor(() => expect(purgeExpired).toHaveBeenCalledTimes(1));
    purge.stop();
  });

  it('周期触发 purgeExpired（每小时一次）', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockResolvedValue(['turn-1']);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const logger = mockLogger();
    const purge = new CheckpointPurge(store, 30 * 24 * 60 * 60 * 1000, logger);
    purge.start();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2); // 启动 1 次 + 定时 1 次
    expect(logger.info).toHaveBeenCalledTimes(2);
    purge.stop();
  });

  it('purge 抛错不中断定时器', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue([]);
    const store = { purgeExpired } as unknown as CheckpointStore;
    const logger = mockLogger();
    const purge = new CheckpointPurge(store, 1000, logger);
    purge.start();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    purge.stop();
  });
});
