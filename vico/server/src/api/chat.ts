import {Hono} from 'hono';
import type {Event, ResumeEntry, RunAgentInput} from '@ag-ui/core';
import type {ApprovalMode} from '@vico/tool';
import type {ReasoningEffort} from '@vico/model';
import type {ModelMessage} from '@ai-sdk/provider-utils';
import {SESSION_SCOPE_REASON} from '@vico/types';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {executeAgentChat} from '../chat/chat.js';
import {chunkToAgUiStream} from '../chat/chunk-to-agui.js';

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

/** 客户端经 forwardedProps 下发的运行配置（原 body.config 平铺到 forwardedProps） */
interface ForwardedConfig {
  agentId?: string;
  modelName?: string;
  reasoningEffort?: string;
  approvalMode?: string;
  workspace?: string;
}

/** ag-ui resume 决议 payload（工具审批：approved / reason / scope） */
interface ApprovalResumePayload {
  approved?: boolean;
  reason?: string;
  scope?: 'turn' | 'session';
}

/**
 * RunAgentInput.resume → ModelMessage（tool-approval-response part，in-band 承载审批决策）。
 * approvalId 复用 toolCallId（引擎约定）；scope:'session' 经 SESSION_SCOPE_REASON 标记。
 */
function resumeToModelMessages(resume: ResumeEntry[]): ModelMessage[] {
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

/** ag-ui 消息 → 本轮输入 ModelMessage（历史由 Memory 注入，仅取最后一条 user 消息） */
function aguiMessagesToModelMessages(messages: RunAgentInput['messages']): ModelMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return [];
  const text = typeof last.content === 'string'
    ? last.content
    : last.content.filter((p) => p.type === 'text').map((p) => p.text).join('');
  return text ? [{ role: 'user', content: text }] : [];
}

/** 把 ag-ui 事件流编码为 SSE Response */
function aguiSSEResponse(events: ReadableStream<Event>, headers?: Record<string, string>): Response {
  const body = events.pipeThrough(new TransformStream<Event, string>({
    transform(event, controller) {
      controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
    },
  }));
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...headers,
    },
  });
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** ag-ui 单 Agent 对话（含审批 interrupts 恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const input = await c.req.json() as RunAgentInput;
    const config = input.forwardedProps as ForwardedConfig | undefined;

    // 本地临时 threadId 视为无真实线程，交由服务端新建
    const requestedThreadId = input.threadId;
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;
    const threadId = isLocalThreadId ? undefined : requestedThreadId;

    // 审批恢复：resume → tool-approval-response；否则取最后一条 user 消息
    const messages = input.resume?.length
      ? resumeToModelMessages(input.resume)
      : aguiMessagesToModelMessages(input.messages);

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
      userId: auth.userId,
      model: config?.modelName,
      reasoning: toReasoningEffort(config?.reasoningEffort),
      approvalMode: toApprovalMode(config?.approvalMode),
      workspace: config?.workspace,
      signal: c.req.raw.signal,
    });

    const events = chunkToAgUiStream({
      stream: output.stream,
      threadId: thread.id,
      runId: input.runId,
    });

    return aguiSSEResponse(events, { 'x-thread-id': thread.id });
  });
}
