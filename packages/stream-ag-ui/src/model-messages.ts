// @vico/stream-ag-ui - ag-ui 消息/resume → 引擎 ModelMessage 转换（本轮输入）。
//
// 路由层把前端 ag-ui RunAgentInput 解析后，经本模块转换为引擎入参 ModelMessage[]：
// - messages → 最后一条 user 消息（历史由 Memory 注入）
// - resume → tool-approval-response（in-band 承载审批决策）
import type {ResumeEntry, RunAgentInput} from '@ag-ui/core';
import type {ModelMessage} from '@vico/model';
import {SESSION_SCOPE_REASON} from '@vico/types';

/** ag-ui resume 决议 payload（工具审批：approved / reason / scope） */
interface ApprovalResumePayload {
  approved?: boolean;
  reason?: string;
  scope?: 'turn' | 'session';
}

/**
 * RunAgentInput.resume → ModelMessage（tool-approval-response part，in-band 承载审批决策）。
 * approvalId 复用 toolCallId（引擎约定）；scope:'session' 经 SESSION_SCOPE_REASON 标记。
 *
 * @param resume - ag-ui 恢复决议条目（interrupt 的响应）
 * @returns 单条 tool 角色的 ModelMessage，parts 为 tool-approval-response
 */
export function resumeToModelMessages(resume: ResumeEntry[]): ModelMessage[] {
  const parts = resume.map((r) => {
    const payload = (r.payload ?? {}) as ApprovalResumePayload;
    const approved = payload.approved ?? r.status === 'resolved';
    const reason = payload.scope === 'session' ? SESSION_SCOPE_REASON : payload.reason;
    return {
      type: 'tool-approval-response' as const,
      approvalId: r.interruptId,
      approved,
      ...(reason != null ? { reason } : {}),
    };
  });
  return [{ role: 'tool', content: parts } as ModelMessage];
}

/**
 * ag-ui 消息 → 本轮输入 ModelMessage（历史由 Memory 注入，仅取最后一条 user 消息）。
 *
 * @param messages - RunAgentInput.messages（ag-ui 消息数组）
 * @returns 仅含最后一条 user 文本消息的 ModelMessage 数组；无有效文本时为空数组
 */
export function aguiMessagesToModelMessages(messages: RunAgentInput['messages']): ModelMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return [];
  const text = typeof last.content === 'string'
    ? last.content
    : last.content.filter((p) => p.type === 'text').map((p) => p.text).join('');
  return text ? [{ role: 'user', content: text }] : [];
}
