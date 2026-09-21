// src/thread/utils.ts — ThreadStore Message 与原生 ModelMessage/UIMessage 的相互转换
import type {Message} from './thread-store.js';
import type {ModelMessage, ToolUIPart, UIMessage} from 'ai';
import type {ToolApprovalRequest, ToolApprovalResponse, ToolCallPart, ToolResultPart} from '@ai-sdk/provider-utils';

/**
 * ThreadStore Message → 原生 ModelMessage（content 反序列化）。
 * 解析失败时按纯文本内容兜底（防御历史脏数据）。
 */
export function toModelMessages(entries: Message[]): ModelMessage[] {
  return entries.map((e) => {
    let content: ModelMessage['content'];
    try {
      content = JSON.parse(e.content) as ModelMessage['content'];
    } catch {
      content = e.content;
    }
    return { role: e.role, content } as ModelMessage;
  });
}

/**
 * 原生 ModelMessage → ThreadStore 持久化字段（content 序列化）。
 */
export function fromModelMessage(msg: ModelMessage): Pick<Message, 'role'|'content'> {
  return { role: msg.role, content: JSON.stringify(msg.content) };
}

/**
 * 解析 Message.content 为规范形态（string 或 parts 数组）。
 * content 由 fromModelMessage 以 JSON.stringify 写入，反序列化即还原 ModelMessage.content。
 */
function parseContent(content: string): ModelMessage['content'] {
  return JSON.parse(content) as ModelMessage['content'];
}

/** 判断 UIMessage part 是否为静态 tool part（type 以 tool- 开头） */
function isToolUIPart(part: UIMessage['parts'][number]): part is ToolUIPart {
  return typeof part.type === 'string' && part.type.startsWith('tool-');
}

/**
 * ModelMessage tool-call part → UIMessage tool part（初始 input-available，
 * 等待后续 tool-result 合并改写为 output-available / output-error）。
 *
 * 依赖 UIMessage 默认泛型 TOOLS = UITools（Record<string, UITool>），
 * 使 type 的模板字面量 `tool-${string}` 可匹配任意动态工具名，无需自建宽松中间类型。
 */
function toToolUIPart(part: ToolCallPart): ToolUIPart {
  return {
    type: `tool-${part.toolName ?? 'unknown'}`,
    toolCallId: part.toolCallId ?? '',
    input: part.input,
    state: 'input-available',
  } as ToolUIPart;
}

/**
 * ModelMessage tool-approval-request part → UIMessage approval-requested tool part。
 *
 * 审批请求 part 仅携带 approvalId/toolCallId，不含 toolName/input，
 * 故从同条 assistant 消息的对应 tool-call part 借取（按 toolCallId 匹配）。
 *
 * @param part - 审批请求 part
 * @param toolCall - 对应的 tool-call part
 */
function toApprovalRequestedUIPart(part: ToolApprovalRequest, toolCall: ToolCallPart): ToolUIPart {
  return {
    type: `tool-${toolCall.toolName}`,
    toolCallId: part.toolCallId,
    input: toolCall.input,
    state: 'approval-requested',
    approval: {
      id: part.approvalId,
      ...(part.isAutomatic != null ? { isAutomatic: part.isAutomatic } : {}),
      ...(part.signature != null ? { signature: part.signature } : {}),
    },
  } as ToolUIPart;
}

/**
 * 将 tool-result part 合并到目标 assistant 消息的对应 tool part，按 ToolResultOutput
 * 判别式做完整转换：
 *
 * - error-text / error-json → output-error（errorText 统一为 string）
 * - execution-denied → output-denied（approval.approved = false）
 * - text / json / content → output-available（output = value）
 *
 * @param assistant - 目标 assistant 消息（原地改写 parts）
 * @param raw - tool-result part
 */
function mergeToolResult(assistant: UIMessage, raw: ToolResultPart): void {
  const output = raw.output;
  assistant.parts = assistant.parts.map((ap) => {
    if (!isToolUIPart(ap) || ap.toolCallId !== raw.toolCallId) return ap;
    switch (output.type) {
      case 'error-text':
        return { ...ap, state: 'output-error', errorText: output.value } as ToolUIPart;
      case 'error-json':
        return { ...ap, state: 'output-error', errorText: JSON.stringify(output.value) } as ToolUIPart;
      case 'execution-denied':
        return {
          ...ap,
          state: 'output-denied',
          approval: {
            id: ap.approval?.id ?? raw.toolCallId,
            approved: false,
            ...(output.reason != null && { reason: output.reason }),
          },
        } as ToolUIPart;
      default:
        // text / json / content 均携带 value，透传给 output-available
        return { ...ap, state: 'output-available', output: output.value } as ToolUIPart;
    }
  });
}

/**
 * 将 tool-approval-response part 合并到目标 assistant 消息的对应 tool part（approval-responded）。
 * approvalId 复用 toolCallId（引擎约定），据此定位 tool part。
 *
 * @param assistant - 目标 assistant 消息（原地改写 parts）
 * @param approval - 审批响应 part
 */
function mergeApprovalResponse(assistant: UIMessage, approval: ToolApprovalResponse): void {
  assistant.parts = assistant.parts.map((ap) => {
    if (!isToolUIPart(ap) || ap.toolCallId !== approval.approvalId) return ap;
    return {
      ...ap,
      state: 'approval-responded',
      approval: {
        id: approval.approvalId,
        approved: approval.approved,
        ...(approval.reason != null ? { reason: approval.reason } : {}),
      },
    } as ToolUIPart;
  });
}

/**
 * user / assistant / system 消息的 content → UIMessage parts。
 * 仅 assistant 消息可能携带 tool-call / tool-approval-request part，转成对应 tool part；
 * 其余 part 及 user/system 消息的 part 原样透传。
 *
 * @param content - 反序列化后的消息 content（string 或 parts 数组）
 * @param role - 消息角色
 */
function contentToParts(content: ModelMessage['content'], role: string): UIMessage['parts'] {
  if (!Array.isArray(content)) {
    return [{ type: 'text', text: String(content) }];
  }
  if (role !== 'assistant') {
    return content.map((p) => p as UIMessage['parts'][number]);
  }
  // 建立 toolCallId → tool-call part 映射，供 tool-approval-request 借取 toolName/input
  const toolCallById = new Map<string, ToolCallPart>();
  // 建立 toolCallId → tool-approval-request part 映射，判断 tool-call 是否伴随审批请求
  const approvalRequestById = new Map<string, ToolApprovalRequest>();
  for (const p of content) {
    if (p.type === 'tool-call') toolCallById.set(p.toolCallId, p);
    else if (p.type === 'tool-approval-request') approvalRequestById.set(p.toolCallId, p);
  }

  const parts: UIMessage['parts'] = [];
  // 已产出的 toolCallId：同一工具调用若同时存在 tool-call 与 tool-approval-request，
  // 只产出一条 tool part（合并为 approval-requested），避免重复构建。
  const emitted = new Set<string>();
  for (const p of content) {
    if (p.type === 'tool-call') {
      if (emitted.has(p.toolCallId)) continue;
      const approval = approvalRequestById.get(p.toolCallId);
      parts.push(approval ? toApprovalRequestedUIPart(approval, p) : toToolUIPart(p));
      emitted.add(p.toolCallId);
    } else if (p.type === 'tool-approval-request') {
      if (emitted.has(p.toolCallId)) continue;
      const toolCall = toolCallById.get(p.toolCallId);
      if (!toolCall) continue; // 无对应 tool-call，无法构建有意义的 tool part
      parts.push(toApprovalRequestedUIPart(p, toolCall));
      emitted.add(p.toolCallId);
    } else {
      parts.push(p as UIMessage['parts'][number]);
    }
  }
  return parts;
}

/**
 * ThreadStore Message → UIMessage（历史展示用）。
 *
 * - tool 角色消息不产出独立 UIMessage，其 part 按 toolCallId/approvalId 合并到最近一条
 *   assistant 消息的对应 tool part：tool-result → output-available / output-error，
 *   tool-approval-response → approval-responded。
 * - assistant 消息的 tool-call part 转为 `tool-${toolName}`（初始 input-available）；
 *   tool-approval-request part 转为 approval-requested（借对应 tool-call 的 toolName/input）。
 * - user / assistant / system 角色原样保留；未知角色静默跳过。
 *
 * @param entries - ThreadStore 消息记录
 * @returns 可直接渲染的 UIMessage 数组
 */
export function toUiMessages(entries: Message[]): UIMessage[] {
  const result: UIMessage[] = [];
  let lastAssistantIndex = -1;

  for (const entry of entries) {
    const content = parseContent(entry.content);

    // tool 消息 → 合并 tool-result / tool-approval-response 到最近 assistant 的 tool part
    if (entry.role === 'tool') {
      if (lastAssistantIndex < 0 || !Array.isArray(content)) continue;
      const assistant = result[lastAssistantIndex]!;
      for (const raw of content) {
        if (raw.type === 'tool-result' && typeof raw.toolCallId === 'string') {
          mergeToolResult(assistant, raw);
        } else if (raw.type === 'tool-approval-response') {
          mergeApprovalResponse(assistant, raw);
        }
      }
      continue;
    }

    // 仅 user / assistant / system 产出 UIMessage，未知角色跳过
    if (entry.role !== 'user' && entry.role !== 'assistant' && entry.role !== 'system') continue;

    result.push({ id: entry.id, role: entry.role, parts: contentToParts(content, entry.role) });
    if (entry.role === 'assistant') lastAssistantIndex = result.length - 1;
  }

  return result;
}
