// src/agent-loop/token-economy.ts
import type { UsageMetrics } from './types.js';

/** Token 经济管理 — 跟踪累计用量，按预算截断 */
export class TokenEconomy {
  private inputTokens = 0;
  private outputTokens = 0;
  private inputBudget: number;
  private outputBudget: number;

  constructor(inputBudget = 100_000, outputBudget = 20_000) {
    this.inputBudget = inputBudget;
    this.outputBudget = outputBudget;
  }

  track(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
  }

  /**
   * 检查输入预算是否超限。
   *
   * @returns 是否已超过输入 token 预算
   */
  isInputExhausted(): boolean {
    return this.inputTokens >= this.inputBudget;
  }

  /**
   * 检查输出预算是否超限。
   *
   * @returns 是否已超过输出 token 预算
   */
  isOutputExhausted(): boolean {
    return this.outputTokens >= this.outputBudget;
  }

  getUsage(): UsageMetrics {
    return { input: this.inputTokens, output: this.outputTokens };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
