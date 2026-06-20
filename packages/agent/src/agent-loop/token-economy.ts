// src/agent-loop/token-economy.ts

/** Token 经济管理 — 跟踪累计用量，按预算截断 */
export class TokenEconomy {
  private inputTokens = 0;
  private outputTokens = 0;
  private inputBudget: number;
  private outputBudget: number;
  /** 每个工具结果的最大长度 */
  private maxToolResultLength: number;

  constructor(inputBudget = 100_000, outputBudget = 20_000, maxToolResultLength = 4000) {
    this.inputBudget = inputBudget;
    this.outputBudget = outputBudget;
    this.maxToolResultLength = maxToolResultLength;
  }

  track(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
  }

  /** 检查输入预算是否超限 */
  isInputExhausted(): boolean {
    return this.inputTokens >= this.inputBudget;
  }

  /** 检查输出预算是否超限 */
  isOutputExhausted(): boolean {
    return this.outputTokens >= this.outputBudget;
  }

  /** 截断工具输出 */
  truncateToolOutput(output: string): string {
    if (output.length <= this.maxToolResultLength) return output;
    return output.slice(0, this.maxToolResultLength) + '... [truncated]';
  }

  getUsage(): { input: number; output: number } {
    return { input: this.inputTokens, output: this.outputTokens };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
