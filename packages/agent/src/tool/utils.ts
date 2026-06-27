// @vico/agent - Tool utility functions
import type { ToolPolicy, ToolCall } from './types.js';
import type { ApprovalDecision, PolicyContext } from './types.js';

/** 根据审批策略判断工具调用是否批准 */
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
