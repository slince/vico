/**
 * Chat 执行引擎 — 纯 Vico 写法：getAgent 拿到实例，stream 执行。
 */
import type {ToolApproval, TurnOutput} from '@vico/agent';
import {getAgent} from '../agent/get-agent.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId: string;
  tenantId: string;
  userId: string;
  /** 审批决策。若 thread 中存在 paused turn，runTurn 自动恢复执行 */
  approvalDecisions?: ToolApproval[];
}

/** 执行 Agent 对话 — 通过 vico.stream，自动处理新对话和暂停恢复 */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<TurnOutput> {
  const { agentId, message, threadId, tenantId, userId, approvalDecisions } = params;

  if (!message?.trim() && !approvalDecisions?.length) throw new Error('Message is required');

  const agent = await getAgent(agentId);

  return agent.stream(message, {
    threadId,
    userId,
    scopeId: tenantId,
    approvalDecisions,
  });
}
