/**
 * Chat 执行引擎 — 纯 Vico 写法：getAgent 拿到实例，解析/创建 thread 后 stream 执行。
 */
import type {Agent, Thread, TurnOutput} from '@vico/core';
import {getAgent} from '../agent/get-agent.js';
import type {UIMessage} from 'ai';

export interface ExecuteChatParams {
  agentId: string;
  /** 用户消息：原生 UIMessage（审批响应随 parts 下传，agent 内部自动提取） */
  message?: UIMessage;
  /** 客户端传入的真实线程 ID；为空时新建线程 */
  threadId?: string;
  userId?: string;
}

/** executeAgentChat 返回结果：流输出 + 解析后的线程（新建时含服务端生成的 ID） */
export interface ExecuteChatResult {
  output: TurnOutput;
  thread: Thread;
}

/** 会话标题最大长度（超出截断） */
const TITLE_MAX_LENGTH = 30;

/**
 * 从用户消息提取会话标题（拼接文本 part，超长截断），空则返回 undefined。
 *
 * @param message - 用户消息（UIMessage）
 * @returns 标题文本，无文本时为 undefined
 */
function deriveTitle(message: UIMessage | undefined): string | undefined {
  if (!message) return undefined;
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim();
  if (!text) return undefined;
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text;
}

/**
 * 解析会话线程：有真实 threadId 则查库复用，查不到或未传则新建。
 *
 * @param agent - 已解析的 Agent 实例
 * @param threadId - 客户端传入的线程 ID（可能为空）
 * @param userId - 当前用户 ID，用于校验线程归属
 * @param title - 新建线程时的标题（由首条用户消息派生）
 * @returns 待执行的 Thread
 */
async function resolveThread(
  agent: Agent,
  threadId: string | undefined,
  userId: string | undefined,
  title: string | undefined,
): Promise<Thread> {
  if (threadId) {
    const existing = await agent.thread.getThread(threadId);
    // 仅复用归属当前用户的线程，防止跨用户恢复他人会话
    if (existing && (!existing.userId || existing.userId === userId)) {
      return existing;
    }
  }
  return agent.createThread({ userId, title });
}

/** 执行 Agent 对话 — 通过 vico.stream，自动处理新对话和暂停恢复 */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<ExecuteChatResult> {
  const { agentId, message, threadId, userId } = params;

  const agent = await getAgent(agentId);
  const thread = await resolveThread(agent, threadId, userId, deriveTitle(message));

  const output = await agent.stream(message ? [message] : [], { thread });

  return { output, thread };
}
