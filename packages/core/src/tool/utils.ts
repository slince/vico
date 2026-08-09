// @vico/core - Tool utility functions
import type {ApprovalDecision, PolicyContext, Tool, ToolCall, ToolPolicy} from './types.js';

/**
 * 根据审批策略判断工具调用是否批准。
 *
 * 支持四种策略：auto（自动批准）、never（拒绝）、on-request（首次需审批）、suggest（建议但自动批准）。
 *
 * @param call - 工具调用对象，包含工具名称等信息
 * @param tool - 工具定义对象，包含 kind、tags 等元数据
 * @param policy - 工具的审批策略
 * @param ctx - 策略上下文，包含是否首次使用、之前是否批准等信息
 * @returns 审批决策，包含是否批准及拒绝原因
 */
export function resolvePolicy<TInput = unknown, TOutput = unknown>(
  call: ToolCall<TInput>,
  tool: Tool<TInput, TOutput>,
  policy: ToolPolicy,
  ctx: PolicyContext<TInput>,
): ApprovalDecision {
  switch (policy) {
    case 'auto':
      return { status: 'approved' };
    case 'suggest':
      return { status: 'approved', suggested: true };
    case 'never':
      return { status: 'denied', reason: `工具 ${call.name} 被策略阻止` };
    case 'on-request':
      // 同一 turn 内已审批通过的工具，后续调用自动放行
      if (!ctx.firstUse && ctx.previousApproved) {
        return { status: 'approved' };
      }
      return { status: 'paused', reason: `工具 ${call.name} 首次使用需要用户审批` };
    default:
      return { status: 'denied', reason: `未知策略: ${policy}` };
  }
}
