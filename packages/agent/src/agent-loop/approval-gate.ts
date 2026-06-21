// src/agent-loop/approval-gate.ts
import type { ToolCall } from '../tool/types.js';
import type { ApprovalDecision } from '../tool/types.js';
import type { EventRecorder } from '../observable/types.js';

/** 外部审批处理函数 — 返回决策或 timeout 后默认拒绝 */
export type ApprovalHandler = (call: ToolCall) => Promise<ApprovalDecision>;

/** 审批门控 — 管理需要用户审批的工具调用 */
export class ApprovalGate {
  private handler: ApprovalHandler;
  private events: EventRecorder;
  private defaultTimeout: number;

  constructor(handler: ApprovalHandler, events: EventRecorder, defaultTimeout = 60_000) {
    this.handler = handler;
    this.events = events;
    this.defaultTimeout = defaultTimeout;
  }

  /** 请求审批，带超时回退 */
  async requestApproval(call: ToolCall, timeoutMs?: number): Promise<ApprovalDecision> {
    // 发射审批请求事件
    this.events.emit({
      type: 'approval_request',
      callId: call.id,
      name: call.name,
      args: call.args,
    });

    const timeout = timeoutMs ?? this.defaultTimeout;

    try {
      const decision = await Promise.race([
        this.handler(call),
        new Promise<ApprovalDecision>((resolve) =>
          setTimeout(() => resolve({ approved: false, reason: 'Approval timeout' }), timeout),
        ),
      ]);
      return decision;
    } catch {
      return { approved: false, reason: 'Approval handler error' };
    }
  }
}
