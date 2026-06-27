// @vico/agent - Tool utility functions
import type { ToolPolicy, ToolCall } from './types.js';
import type { ApprovalDecision, PolicyContext } from './types.js';

/**
 * 根据审批策略判断工具调用是否批准。
 *
 * 支持四种策略：auto（自动批准）、never（拒绝）、on-request（首次需审批）、suggest（建议但自动批准）。
 *
 * @param policy - 工具的审批策略
 * @param call - 工具调用对象，包含工具名称等信息
 * @param ctx - 策略上下文，包含是否首次使用、之前是否批准等信息
 * @returns 审批决策，包含是否批准及拒绝原因
 */
export function resolvePolicy(
  policy: ToolPolicy,
  call: ToolCall,
  ctx: PolicyContext,
): ApprovalDecision {
  switch (policy) {
    case 'auto':
      return { approved: true };
    case 'never':
      return { approved: false, reason: `Tool ${call.name} is blocked by policy` };
    case 'on-request':
      if (!ctx.firstUse && ctx.previousApproved) {
        return { approved: true };
      }
      return { approved: false, reason: `Tool ${call.name} requires user approval on first use` };
    case 'suggest':
      return { approved: true };
    default:
      return { approved: false, reason: `Unknown policy: ${policy}` };
  }
}
