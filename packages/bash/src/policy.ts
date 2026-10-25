// @vico/bash - 拦截策略：PolicyDecision / InterceptionPolicy / withPolicy

import { analyzeCommand } from './analyze.js';

import type { CommandExecutor } from './executor.js';
import type { AnalyzeOptions, CommandAnalysis } from './analyze.js';
import type { Command, CommandResult } from './command.js';

/**
 * 策略裁决结果：是否放行，以及可选的拒绝理由。
 *
 * - `allow`：`true` 放行执行，`false` 拦截
 * - `reason`：拦截原因（`allow=false` 时进入 blocked 结果的 `blockReason` / `stderr`）
 */
export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

/**
 * 拦截策略：在命令执行前对其结构化分析与裁决。
 *
 * `evaluate` 支持同步或异步返回 {@link PolicyDecision}；`withPolicy` 内部
 * 统一 `await`，因此实现可以自由选择同步 / 异步形式。
 */
export interface InterceptionPolicy {
  /**
   * 对一条命令及其分析结果做裁决。
   *
   * @param command 待执行的命令
   * @param analysis `analyzeCommand` 对 `command` 的分析产物
   * @returns 放行 / 拦截决策（同步或异步）
   */
  evaluate(command: Command, analysis: CommandAnalysis): PolicyDecision | Promise<PolicyDecision>;
}

/**
 * 放行策略：对一切命令一律放行，作为缺省 / 无拦截场景的兜底。
 */
export const permissivePolicy: InterceptionPolicy = {
  evaluate: () => ({ allow: true }),
};

/**
 * 用拦截策略包装一个执行器。
 *
 * 执行流程：先 `analyzeCommand(command, analyzeOptions)` 得到分析产物，再
 * `await policy.evaluate(command, analysis)`。若裁决 `allow=false`，直接返回
 * blocked 结果（不调用内层执行器）；否则透传 `executor.execute(command)`。
 *
 * @param executor 内层真实执行器
 * @param policy 拦截策略
 * @param analyzeOptions 可选，传给 `analyzeCommand` 的分析配置
 * @returns 包装后的执行器（签名与 {@link CommandExecutor} 一致）
 */
export function withPolicy(
  executor: CommandExecutor,
  policy: InterceptionPolicy,
  analyzeOptions?: AnalyzeOptions,
): CommandExecutor {
  return {
    async execute(command: Command): Promise<CommandResult> {
      const analysis = analyzeCommand(command, analyzeOptions);

      const decision = await policy.evaluate(command, analysis);

      if (!decision.allow) {
        const reason = decision.reason;

        return {
          stdout: '',
          stderr: `Blocked by policy: ${reason ?? 'denied'}`,
          exitCode: null,
          durationMs: 0,
          blocked: true,
          blockReason: reason,
        };
      }

      return executor.execute(command);
    },
  };
}
