import type { CheckpointStore } from '@vico/core';

/** 清理周期：1 小时 */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 启动 checkpoint 版本链 TTL 清理：立即执行一次 + 每小时周期执行。
 * 整链删除由 store.purgeExpired 负责（一个 turn 的所有版本一起删）。
 *
 * @param store - CheckpointStore
 * @param ttlMs - 版本链存活时间（TTL）
 * @param log - pino logger
 * @returns 停止函数（清除定时器）
 */
export function startCheckpointPurge(
  store: CheckpointStore,
  ttlMs: number,
  log: { info: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void },
): () => void {
  const run = async (): Promise<void> => {
    try {
      const purged = await store.purgeExpired(ttlMs);
      if (purged.length > 0) {
        log.info({ turns: purged }, 'purged expired checkpoint chains');
      }
    } catch (err) {
      log.error({ err }, 'purgeExpired failed');
    }
  };

  // 启动时立即执行一次
  void run();

  const timer = setInterval(() => void run(), PURGE_INTERVAL_MS);
  // 不阻止进程退出
  timer.unref?.();

  return () => clearInterval(timer);
}
