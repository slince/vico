// @vico/stream-ag-ui - 工具审批 interrupt 构造（流式与历史两条路径共用，保证前端审批 UI 一致）。
import type { Interrupt } from '@ag-ui/core';

/**
 * 构造工具审批 interrupt（ag-ui 协议）。
 *
 * - reason 固定 'tool_call'：ag-ui 据此将决议绑定到具体工具调用
 * - responseSchema 描述决议载荷：approved 必填，reason / scope 可选
 *
 * @param approvalId - 审批标识（与 toolCallId 同源，resume 时按此 id 回传决议）
 * @param toolCallId - 被审批的工具调用 id
 * @param toolName - 工具名（用于提示文案与前端展示）
 * @param input - 工具入参（透传给前端展示）
 * @returns ag-ui Interrupt
 */
export function toolApprovalInterrupt(
  approvalId: string,
  toolCallId: string,
  toolName: string,
  input: unknown,
): Interrupt {
  return {
    id: approvalId,
    reason: 'tool_call',
    message: `Approve tool "${toolName}"?`,
    toolCallId,
    responseSchema: {
      type: 'object',
      properties: {
        approved: { type: 'boolean' },
        reason: { type: 'string' },
        scope: { type: 'string', enum: ['turn', 'session'] },
      },
      required: ['approved'],
    },
    metadata: {
      toolName,
      input,
    },
  };
}
