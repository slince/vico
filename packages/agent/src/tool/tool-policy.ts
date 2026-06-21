// src/tool/tool-policy.ts
import type { ToolPolicy, ToolCall } from './types.js';
import type { ApprovalDecision, PolicyContext } from './types.js';

export type { PolicyContext } from './types.js';

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
        return { approved: true }; // already approved for this session
      }
      return { approved: false, reason: `Tool ${call.name} requires user approval on first use` };
    case 'suggest':
      return { approved: true }; // suggest 不阻塞，仅记录
    default:
      return { approved: false, reason: `Unknown policy: ${policy}` };
  }
}
