// @vico/checkpoint - Checkpoint 版本链 TTL 清理器（后台定时清理）

import type { Logger } from 'pino';
import type { CheckpointStore } from './checkpoint.js';

/** 清理周期：1 小时 */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Checkpoint 版本链 TTL 清理器：启动后立即清理一次，并每小时周期清理。
 *
 * 整链删除由 `store.purgeExpired` 负责（一个 turn 的所有版本一起删）；
 * 清理为尽力而为，单次失败仅记录日志，不影响后续周期。
 */
export class CheckpointPurge {
  /** 周期清理定时器；未启动或已停止时为 undefined */
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: CheckpointStore,
    private readonly ttlMs: number,
    private readonly logger: Logger,
  ) {}

  /**
   * 启动清理：立即执行一次，并注册每小时周期任务。
   *
   * 定时器 `unref`，不阻止进程退出。
   */
  start(): void {
    void this.run();

    this.timer = setInterval(() => void this.run(), PURGE_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** 停止周期清理（已触发的清理不中断） */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** 单次清理：调用 store 清理过期版本链，失败仅记录日志 */
  private async run(): Promise<void> {
    try {
      const purged = await this.store.purgeExpired(this.ttlMs);
      if (purged.length > 0) {
        this.logger.info({ turns: purged }, 'purged expired checkpoint chains');
      }
    } catch (err) {
      this.logger.error({ err }, 'purgeExpired failed');
    }
  }
}
