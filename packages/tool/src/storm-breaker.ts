// src/tool/storm-breaker.ts

interface CallRecord {
  name: string;
  argsKey: string;
  count: number;
  totalCount: number;
}

/** 工具风暴断路器 — 检测同一工具+参数组合的重复调用 */
export class StormBreaker {
  private records: Map<string, CallRecord> = new Map();
  private warnThreshold = 3;
  private killThreshold = 5;

  constructor(options?: { warnThreshold?: number; killThreshold?: number }) {
    if (options?.warnThreshold) this.warnThreshold = options.warnThreshold;
    if (options?.killThreshold) this.killThreshold = options.killThreshold;
  }

  /**
   * 检查工具调用是否应被阻止。
   *
   * 根据已记录的调用次数判断：达到 warnThreshold 触发警告，达到 killThreshold 触发阻止。
   *
   * @param callName - 工具名称
   * @param callArgs - 工具调用参数
   * @returns 包含 blocked（是否阻止）和 warning（是否警告）标志的对象
   */
  check(callName: string, callArgs: unknown): { blocked: boolean; warning: boolean } {
    const key = `${callName}:${JSON.stringify(callArgs)}`;
    const record = this.records.get(key);
    if (!record) return { blocked: false, warning: false };
    return {
      warning: record.count >= this.warnThreshold && record.count < this.killThreshold,
      blocked: record.count >= this.killThreshold,
    };
  }

  record(callName: string, callArgs: unknown): void {
    const key = `${callName}:${JSON.stringify(callArgs)}`;
    const existing = this.records.get(key);
    if (existing) {
      existing.count++;
      existing.totalCount++;
    } else {
      this.records.set(key, { name: callName, argsKey: key, count: 1, totalCount: 1 });
    }
  }

  reset(): void {
    this.records.clear();
  }
}
