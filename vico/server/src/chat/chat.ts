/**
 * Chat 执行引擎 — 纯 Vico 写法：getAgent 拿到实例，stream 执行。
 */
import type {TurnOutput, UserMessage} from '@vico/core';
import {getAgent} from '../agent/get-agent.js';

export interface ExecuteChatParams {
  agentId: string;
  /** 用户消息：纯文本或原生 UIMessage[]（审批响应随 UIMessage parts 下传，agent 内部自动提取） */
  message: UserMessage;
  threadId: string;
  tenantId: string;
  userId: string;
}

/** 执行 Agent 对话 — 通过 vico.stream，自动处理新对话和暂停恢复 */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<TurnOutput> {
  const { agentId, message, threadId, tenantId, userId } = params;

  const agent = await getAgent(agentId);

  return agent.stream(message, {
    threadId,
    userId,
    scopeId: tenantId,
  });
}
