// @vico/core - 按 key 分片的异步互斥锁

/**
 * 按 key 分片的异步互斥锁 — 同一 key 的任务严格串行，不同 key 互不阻塞。
 *
 * 用于消除「检查-再写入」竞态（如语义记忆去重 + 插入的重复写入）
 * 以及同一作用域下并发写导致的交错覆盖。
 */
export class KeyedMutex {
  /** 每个 key 的锁链尾 — 始终 resolve（永不 reject），保证锁链在任务失败后仍可继续 */
  private tails = new Map<string, Promise<void>>();

  /**
   * 在指定 key 的锁保护下执行任务并返回其结果。
   * 前一个任务失败不会阻塞后续排队任务。
   *
   * @param key - 锁分片键（如 scopeId / 记录 id）
   * @param fn - 需要串行执行的任务
   * @returns 任务执行结果
   */
  run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // 等待前一个持有者释放后执行；结果原样透传给调用方
    const result = prev.then(() => fn());
    // 锁链尾吞掉错误，避免未处理的 rejection 打断后续排队
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    // 该锁链尾结算后，若仍是当前尾则回收，避免 Map 无界增长
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
