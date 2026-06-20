// @vico/agent - HookRunner implementation: concrete hook execution and composition

import type { HookRunner, HookEvent, HookResult } from './hook-types.js';

/** 单个 Hook 的执行器实现 */
export class HookRunnerImpl implements HookRunner {
  constructor(
    public readonly event: HookEvent,
    private handler: (data: unknown) => Promise<HookResult>,
  ) {}

  async run(data: unknown): Promise<HookResult> {
    try {
      return await this.handler(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { action: 'continue', message: `Hook error: ${message}` };
    }
  }
}

/** 组合多个 HookRunner，按顺序执行 */
export class CompositeHookRunner {
  private runners: HookRunner[] = [];

  register(runner: HookRunner): void {
    this.runners.push(runner);
  }

  remove(event: HookEvent): void {
    this.runners = this.runners.filter((r) => r.event !== event);
  }

  getByEvent(event: HookEvent): HookRunner[] {
    return this.runners.filter((r) => r.event === event);
  }

  /** 按顺序执行所有匹配 event 的 hook，遇到 deny 则停止 */
  async runAll(event: HookEvent, data: unknown): Promise<HookResult> {
    let currentData = data;
    for (const runner of this.getByEvent(event)) {
      const result = await runner.run(currentData);
      if (result.action === 'deny') return result;
      if (result.action === 'modify' && result.modifiedData !== undefined) {
        currentData = result.modifiedData;
      }
    }
    return { action: 'continue', modifiedData: currentData };
  }
}
