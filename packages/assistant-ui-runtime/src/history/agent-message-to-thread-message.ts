/**
 * 历史映射：`AgentMessage`（后端持久化的原生 ModelMessage + id/turnId）→ assistant-ui `ThreadMessage`。
 *
 * 设计要点：
 * - 消息 id 直接沿用 `AgentMessage.id`，因此刷新前后的同一条消息在 UI 上是同一个标识；
 * - assistant 的 tool-call 与后续 `role:'tool'` 消息里的 tool-result 按 toolCallId 合回同一个 part，
 *   这样历史里的工具卡片能显示结果（而不是一串孤立的 tool 气泡）；
 * - `tool-approval-request` part 只在「还没有对应 tool-result」时还原成待决议状态，
 *   让刷新后仍能继续处理暂停在审批上的会话（与旧 ag-ui 行为一致）。
 */
import type {MessageStatus, ThreadAssistantMessagePart, ThreadMessage} from '@assistant-ui/react';
import type {AgentMessage} from '@vico/model';

/** 可变的工具部件中间态（映射过程中会被后续 tool 消息补结果） */
interface ToolPartDraft {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  argsText: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  approval?: {id: string; prompt?: string};
}

type PartDraft = ThreadAssistantMessagePart | ToolPartDraft;

/** 判断是否为可编辑的工具部件草稿 */
function isToolDraft(part: PartDraft): part is ToolPartDraft {
  return part.type === 'tool-call';
}

/**
 * 解包 tool-result 的 output，得到 UI 上展示的结果与该调用是否失败。
 *
 * @param output - 原生 ToolResultOutput（text / json / error-* / execution-denied / content）
 * @returns result 值与 isError 标记
 */
function unwrapToolOutput(output: unknown): {result: unknown; isError: boolean} {
  const o = output as {type?: string; value?: unknown} | undefined;
  switch (o?.type) {
    case 'text':
      return {result: String(o.value ?? ''), isError: false};
    case 'json':
      return {result: o.value, isError: false};
    case 'error-text':
      return {result: String(o.value ?? ''), isError: true};
    case 'error-json':
      return {result: o.value, isError: true};
    case 'execution-denied':
      return {result: 'Tool execution denied', isError: true};
    case 'content':
      return {result: o.value, isError: false};
    default:
      return {result: o?.value ?? output, isError: false};
  }
}

/** 消息内容归一化为 parts 数组（纯字符串内容转为单条文本 part） */
function toParts(content: AgentMessage['content']): unknown[] {
  if (typeof content === 'string') return [{type: 'text', text: content}];
  return Array.isArray(content) ? content : [];
}

/** 从 usage 构造 assistant-ui 的 step 用量 */
function stepsOf(message: AgentMessage) {
  const usage = message.usage;
  if (!usage) return [];
  return [
    {
      usage: {
        inputTokens: usage.inputTokens.total ?? 0,
        outputTokens: usage.outputTokens.total ?? 0,
      },
    },
  ];
}

/** 消息级 metadata.custom：保留 turnId，供前端按 turn 聚合 */
function customOf(message: AgentMessage): Record<string, unknown> {
  return message.turnId === undefined ? {} : {turnId: message.turnId};
}

/**
 * 把一批 `AgentMessage` 映射为 assistant-ui 消息数组。
 *
 * @param messages - 历史接口返回的消息（按时间升序）
 * @returns 可直接交给 `ExportedMessageRepository.fromArray` 的消息数组
 */
export function agentMessagesToThreadMessages(messages: readonly AgentMessage[]): ThreadMessage[] {
  // 已落 tool-result 的调用：审批态不再还原（审批已通过或已被拒绝）
  const resolvedCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    for (const part of toParts(message.content)) {
      const p = part as {type?: string; toolCallId?: string};
      if (p.type === 'tool-result' && p.toolCallId) resolvedCallIds.add(p.toolCallId);
    }
  }

  const result: ThreadMessage[] = [];
  // toolCallId → 已产出的工具部件，供后续 tool 消息补结果
  const toolParts = new Map<string, ToolPartDraft>();

  for (const message of messages) {
    const createdAt = new Date();
    const custom = customOf(message);
    const parts = toParts(message.content);

    if (message.role === 'user') {
      const content: Array<{type: 'text'; text: string} | {type: 'image'; image: string}> = [];
      for (const part of parts) {
        const p = part as {type?: string; text?: string; image?: unknown; data?: unknown; mediaType?: string};
        if (p.type === 'text') content.push({type: 'text', text: p.text ?? ''});
        else if (p.type === 'image' && typeof p.image === 'string') content.push({type: 'image', image: p.image});
        else if (p.type === 'image' && typeof p.data === 'string') {
          content.push({type: 'image', image: `data:${p.mediaType ?? 'image/png'};base64,${p.data}`});
        }
      }
      result.push({
        id: message.id,
        role: 'user',
        createdAt,
        content,
        attachments: [],
        metadata: {custom},
      } as unknown as ThreadMessage);
      continue;
    }

    if (message.role === 'system') {
      const text = parts
        .map((part) => (part as {text?: string}).text ?? '')
        .join('');
      result.push({
        id: message.id,
        role: 'system',
        createdAt,
        content: [{type: 'text', text}],
        metadata: {custom},
      } as unknown as ThreadMessage);
      continue;
    }

    if (message.role === 'tool') {
      for (const part of parts) {
        const p = part as {type?: string; toolCallId?: string; output?: unknown};
        if (p.type !== 'tool-result' || !p.toolCallId) continue;
        const target = toolParts.get(p.toolCallId);
        if (!target) continue;
        const {result: value, isError} = unwrapToolOutput(p.output);
        target.result = value;
        if (isError) target.isError = true;
      }
      continue;
    }

    // assistant
    const content: PartDraft[] = [];
    // 本消息内的待审批请求，先收集再挂到对应工具调用上
    const approvalRequests: Array<{approvalId: string; toolCallId: string}> = [];

    for (const part of parts) {
      const p = part as {
        type?: string;
        text?: string;
        toolCallId?: string;
        toolName?: string;
        input?: unknown;
        approvalId?: string;
        output?: unknown;
      };

      if (p.type === 'reasoning') {
        content.push({type: 'reasoning', text: p.text ?? '', status: {type: 'complete'}});
        continue;
      }
      if (p.type === 'text') {
        content.push({type: 'text', text: p.text ?? '', status: {type: 'complete'}});
        continue;
      }
      if (p.type === 'tool-call' && p.toolCallId) {
        const draft: ToolPartDraft = {
          type: 'tool-call',
          toolCallId: p.toolCallId,
          toolName: p.toolName ?? '',
          argsText: JSON.stringify(p.input ?? {}),
          args: (p.input ?? {}) as Record<string, unknown>,
        };
        content.push(draft);
        toolParts.set(p.toolCallId, draft);
        continue;
      }
      if (p.type === 'tool-result' && p.toolCallId) {
        const target = toolParts.get(p.toolCallId);
        if (target) {
          const {result: value, isError} = unwrapToolOutput(p.output);
          target.result = value;
          if (isError) target.isError = true;
        }
        continue;
      }
      if (p.type === 'tool-approval-request' && p.approvalId) {
        approvalRequests.push({approvalId: p.approvalId, toolCallId: p.toolCallId ?? p.approvalId});
      }
    }

    for (const request of approvalRequests) {
      if (resolvedCallIds.has(request.toolCallId)) continue;
      const target = toolParts.get(request.toolCallId);
      if (!target) continue;
      target.approval = {
        id: request.approvalId,
        prompt: `Approve tool "${target.toolName}"?`,
      };
    }

    const hasPendingApproval = content.some(
      (part) => isToolDraft(part) && part.approval !== undefined,
    );
    const status: MessageStatus = hasPendingApproval
      ? {type: 'requires-action', reason: 'tool-calls'}
      : {type: 'complete', reason: 'stop'};

    result.push({
      id: message.id,
      role: 'assistant',
      createdAt,
      content: content as ThreadAssistantMessagePart[],
      status,
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: stepsOf(message),
        custom,
      },
    } as unknown as ThreadMessage);
  }

  return result;
}
