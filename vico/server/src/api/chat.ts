import {Hono} from 'hono';
import type {ApprovalMode} from '@vico/tool';
import type {ReasoningEffort} from '@vico/model';
import {chunkSSEResponse, resumeToModelMessages, vicoMessagesToModelMessages, type VicoRunRequest} from '@vico/stream-wire';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {executeAgentChat} from '../chat/chat.js';

/** 合法的推理力度取值（与 @vico/model 的 ReasoningEffort 一致） */
const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
];

/** 校验客户端下发的 reasoningEffort，非法值回退 undefined（走 agent 默认） */
function toReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined;
  return (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : undefined;
}

/** 合法的审批政策模式取值（与 @vico/tool 的 ApprovalMode 一致） */
const APPROVAL_MODES: readonly ApprovalMode[] = [
  'approve-all', 'readonly', 'workspace', 'full-access',
];

/**
 * 校验客户端下发的 approvalMode。
 * 未下发（undefined）返回 undefined，由 agent 采用默认策略；
 * 下发但非法（非字符串或不在 APPROVAL_MODES 中）则抛异常，避免静默回退掩盖配置错误。
 */
function toApprovalMode(value: unknown): ApprovalMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(APPROVAL_MODES as readonly string[]).includes(value)) {
    throw new Error(`Invalid approvalMode: ${JSON.stringify(value)}. Expected one of: ${APPROVAL_MODES.join(', ')}`);
  }
  return value as ApprovalMode;
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /**
   * 单 Agent 对话（vico 协议：请求 `VicoRunRequest`，响应 `ChunkType` SSE）。
   *
   * 请求体里的 messages 直接就是 `AgentMessage[]`；审批续跑时改为下发 resume 决议。
   */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json() as VicoRunRequest;
    const config = body.config;

    // 本地草稿线程 ID 视为无真实线程，交由服务端新建（真实 ID 经 x-thread-id 回传）
    const requestedThreadId = body.threadId;
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;
    const threadId = isLocalThreadId ? undefined : requestedThreadId;

    // 审批续跑：resume → tool-approval-response；否则取前端下发的本轮消息
    const messages = body.resume?.length
      ? resumeToModelMessages(body.resume)
      : vicoMessagesToModelMessages(body.messages ?? []);


    if (messages.length === 0) {
      return c.json({ error: 'user message is required' }, 400);
    }

    const agentId = config?.agentId;
    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }

    const { output, thread } = await executeAgentChat({
      agentId,
      messages,
      threadId,
      runId: body.runId,
      userId: auth.userId,
      model: config?.modelName,
      reasoning: toReasoningEffort(config?.reasoningEffort),
      approvalMode: toApprovalMode(config?.approvalMode),
      workspace: config?.workspace,
      signal: c.req.raw.signal,
    });

    return chunkSSEResponse(output.stream, { 'x-thread-id': thread.id });
  });
}
