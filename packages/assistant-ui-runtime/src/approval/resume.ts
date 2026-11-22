/**
 * 审批决议收集：把 assistant-ui 写回 tool-call part 上的 `approval.approved` 转成 resume 载荷。
 *
 * 触发路径：用户点「允许/拒绝」→ `respondToToolApproval()` 把决议写回消息 part → 该消息仍是 head 且
 * `shouldContinue()` 为真 → 本地 runtime 再调一次 chatModel adapter。所以 adapter 每次运行都要先扫一遍
 * 头部 assistant 消息里「已决议但还没发出去」的审批。
 */
import type {ThreadMessage} from '@assistant-ui/react';
import type {VicoApprovalResume} from '../types.js';

/** 已发送审批的记账键（approvalId 本身在一段会话里唯一，直接用它） */
export type SentApprovalIds = Set<string>;

/**
 * 收集需要回传给后端的审批决议。
 *
 * 注意：决议不在 `runOptions.messages` 里 —— 那是「本次 run 之前的消息链」（父路径），
 * 正在续跑的 assistant 消息要经 `runOptions.unstable_getMessage()` 拿。
 *
 * @param ongoing - 正在续跑的 assistant 消息（缺省时退化为消息链的最后一条）
 * @param sent - 已发送过的 approvalId 集合（避免同一决议重复下发）
 * @returns resume 数组；无待发决议时为空数组
 */
export function collectApprovalResumes(
  ongoing: ThreadMessage | undefined,
  sent: SentApprovalIds,
): VicoApprovalResume[] {
  if (!ongoing || ongoing.role !== 'assistant') return [];

  const resumes: VicoApprovalResume[] = [];
  for (const part of ongoing.content) {
    if (part.type !== 'tool-call') continue;
    const approval = part.approval;
    if (!approval) continue;
    // 未决议（approved 为 undefined）或已被宿主标记作废（resolution）的都不回传
    if (approval.approved === undefined) continue;
    if (approval.resolution !== undefined) continue;
    if (sent.has(approval.id)) continue;
    resumes.push({
      approvalId: approval.id,
      approved: approval.approved,
      ...(approval.reason !== undefined && {reason: approval.reason}),
    });
  }
  return resumes;
}

/**
 * 记账已发送的审批。
 *
 * @param resumes - 本次请求携带的 resume
 * @param sent - 记账集合（原地修改）
 */
export function markApprovalsSent(resumes: readonly VicoApprovalResume[], sent: SentApprovalIds): void {
  for (const resume of resumes) sent.add(resume.approvalId);
}
