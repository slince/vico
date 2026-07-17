/**
 * Chat 执行引擎 — 纯 Vico 写法：getAgent 拿到实例，stream 执行。
 */
import type {ToolApproval, TurnOutput, UserMessage} from '@vico/agent';
import {getAgent} from '../agent/get-agent.js';

export interface ExecuteChatParams {
  agentId: string;
  /** 用户消息：纯文本或原生 UIMessage[]（审批恢复时可为空串） */
  message: UserMessage;
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

  const hasMessage = typeof message === 'string' ? !!message.trim() : message.length > 0;
  if (!hasMessage && !approvalDecisions?.length) throw new Error('Message is required');

  const agent = await getAgent(agentId);

  return agent.stream(message, {
    threadId,
    userId,
    scopeId: tenantId,
    approvalDecisions,
  });
}
