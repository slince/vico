// src/agent-loop/approval-gate.ts
import type { ToolCall, ApprovalDecision } from '../tool/types.js';
import type { EventRecorder } from '../events/types.js';

/** 外部审批处理函数 — 返回决策或 timeout 后默认拒绝 */
export type ApprovalHandler = (call: ToolCall) => Promise<ApprovalDecision>;

interface PendingEntry {
  call: ToolCall;
  resolve: (decision: ApprovalDecision) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** 审批门控 — pending-promise 模式，支持外部通过 decide() 提交决策 */
export class ApprovalGate {
  private pending = new Map<string, PendingEntry>();
  private events: EventRecorder<any>;
  private defaultTimeout: number;

  constructor(events: EventRecorder<any>, defaultTimeout = 60_000) {
    this.events = events;
    this.defaultTimeout = defaultTimeout;
  }

  /** 发起审批请求，返回 approvalId 和等待决策的 Promise */
  requestApproval(call: ToolCall, timeoutMs?: number, approvalId?: string): { approvalId: string; decision: Promise<ApprovalDecision> } {
    const id = approvalId ?? crypto.randomUUID();
    const timeout = timeoutMs ?? this.defaultTimeout;

    const decision = new Promise<ApprovalDecision>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        resolve({ approved: false, reason: 'Approval timeout' });
      }, timeout);

      this.pending.set(id, { call, resolve, timeoutId });
    });

    this.events.emit({
      type: 'approval_request',
      approvalId: id,
      callId: call.id,
      name: call.name,
      args: call.args,
    });

    return { approvalId: id, decision };
  }

  /** 外部提交审批决策。返回 true 表示找到并处理了该审批 */
  decide(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timeoutId);
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }

  /** 取消所有待审批请求（turn abort 时调用） */
  cancelAll(reason = 'Cancelled'): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeoutId);
      entry.resolve({ approved: false, reason });
    }
    this.pending.clear();
  }

  /** 当前待审批数量 */
  get pendingCount(): number {
    return this.pending.size;
  }
}
