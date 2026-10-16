import {Hono} from 'hono';
import {createUIMessageStreamResponse, toUIMessageStream, UIMessage} from 'ai';
import type {ApprovalMode, ReasoningEffort} from '@vico/core';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {executeAgentChat} from '../chat/chat.js';

/** 从请求体提取最后一条 UIMessage */
function extractLastMessage(body: Record<string, unknown>): UIMessage | undefined {
  const messages = body.messages as UIMessage[] | undefined;
  if (!messages?.length) return undefined;
  return messages[messages.length - 1];
}

/** 合法的推理力度取值（与 @vico/core 的 ReasoningEffort 一致） */
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

/** 合法的审批政策模式取值（与 @vico/core 的 ApprovalMode 一致） */
const APPROVAL_MODES: readonly ApprovalMode[] = [
  'approve-all', 'readonly', 'workspace', 'full-access',
];

/** 校验客户端下发的 approvalMode，非法值回退 undefined（走 agent 默认策略） */
function toApprovalMode(value: unknown): ApprovalMode | undefined {
  if (typeof value !== 'string') return undefined;
  return (APPROVAL_MODES as readonly string[]).includes(value)
    ? (value as ApprovalMode)
    : undefined;
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话（含审批响应自动恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const lastMessage = extractLastMessage(body);
    const requestedThreadId = body.threadId as string | undefined;
    // 前端通过 modelContext 注入的 config（{ agentId, modelName, reasoningEffort, approvalMode, workspace }）；
    // agentId 优先取 config，兼容 Agent 详情页测试区仍走顶层 body.agentId 的旧路径
    const config = body.config as {
      agentId?: string;
      modelName?: string;
      reasoningEffort?: string;
      approvalMode?: string;
      workspace?: string;
    } | undefined;
    const agentId: string = (config?.agentId ?? body.agentId) as string;

    // 前端本地临时 ID（如 __LOCALID_xxx）视为无真实线程，交由服务端新建
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;

    if (!lastMessage) {
      return c.json({ error: 'user messahe is required' }, 400);
    }

    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }

    // 解析线程：有真实 threadId 则查库复用，无（或本地临时 ID）则新建
    const { output, thread } = await executeAgentChat({
      agentId,
      message: lastMessage,
      threadId: isLocalThreadId ? undefined : requestedThreadId,
      userId: auth.userId,
      model: config?.modelName,
      reasoning: toReasoningEffort(config?.reasoningEffort),
      approvalMode: toApprovalMode(config?.approvalMode),
      workspace: config?.workspace,
    });

    // 桥接 HTTP 请求生命周期到 agent 执行：客户端断开时自动终止 LLM 调用
    c.req.raw.signal.addEventListener('abort', () => output.abort(), { once: true });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: output.stream,
        onError: (err) => {
          if (typeof err === 'string') {
            return err
          }
          return err instanceof Error ? String(err.message) : JSON.stringify(err)
        }
      }),
      headers: {
        'x-thread-id': thread.id
      }
    });
  });
}
