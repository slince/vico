// vico/server - ThreadStore Message → UIMessage 转换（历史展示用）。
//
// 该转换依赖 ai 包的 UIMessage，属 UI 层关注点，故从 @vico/thread 上移到服务端。
// Task 2（ag-ui 迁移）时将替换为 ag-ui 消息的 fromAgUiMessages 转换。
import type {Message} from '@vico/thread';
import type {ModelMessage, ToolUIPart, UIMessage} from 'ai';
import type {ToolApprovalRequest, ToolApprovalResponse, ToolCallPart, ToolResultPart} from '@ai-sdk/provider-utils';

/** 判断 UIMessage part 是否为静态 tool part（type 以 tool- 开头） */
function isToolUIPart(part: UIMessage['parts'][number]): part is ToolUIPart {
  return typeof part.type === 'string' && part.type.startsWith('tool-');
}

/**
 * ModelMessage tool-call part → UIMessage tool part（初始 input-available，
 * 等待后续 tool-result 合并改写为 output-available / output-error）。
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
 * - error-text / error-json → output-error（errorText 统一为 string）
 * - execution-denied → output-denied（approval.approved = false）
 * - text / json / content → output-available（output = value）
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
            ...(output.reason != null ? { reason: output.reason } : {}),
          },
        } as ToolUIPart;
      default:
        return { ...ap, state: 'output-available', output: output.value } as ToolUIPart;
    }
  });
}

/**
 * 将 tool-approval-response part 合并到目标 assistant 消息的对应 tool part（approval-responded）。
 * approvalId 复用 toolCallId（引擎约定），据此定位 tool part。
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
 */
function contentToParts(content: ModelMessage['content'], role: string): UIMessage['parts'] {
  if (!Array.isArray(content)) {
    return [{ type: 'text', text: String(content) }];
  }
  if (role !== 'assistant') {
    return content.map((p) => p as UIMessage['parts'][number]);
  }
  const toolCallById = new Map<string, ToolCallPart>();
  const approvalRequestById = new Map<string, ToolApprovalRequest>();
  for (const p of content) {
    if (p.type === 'tool-call') toolCallById.set(p.toolCallId, p);
    else if (p.type === 'tool-approval-request') approvalRequestById.set(p.toolCallId, p);
  }

  const parts: UIMessage['parts'] = [];
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
      if (!toolCall) continue;
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
 *   assistant 消息的对应 tool part。
 * - assistant 消息的 tool-call part 转为 `tool-${toolName}`（初始 input-available）。
 * - user / assistant / system 角色原样保留；未知角色静默跳过。
 * - 消息 metadata（含 assistant 的 usage 明细）透传到 UIMessage.metadata。
 */
export function toUiMessages(entries: Message[]): UIMessage[] {
  const result: UIMessage[] = [];
  let lastAssistantIndex = -1;

  for (const entry of entries) {
    const content = entry.content;

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

    if (entry.role !== 'user' && entry.role !== 'assistant' && entry.role !== 'system') continue;

    result.push({
      id: entry.id,
      role: entry.role,
      parts: contentToParts(content, entry.role),
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    });
    if (entry.role === 'assistant') lastAssistantIndex = result.length - 1;
  }

  return result;
}
