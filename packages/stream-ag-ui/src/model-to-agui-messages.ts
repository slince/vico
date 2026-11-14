// @vico/stream-ag-ui - ThreadStore Message → ag-ui Message 转换（历史展示用）。
//
// 后端持久化仍是 ModelMessage.content；本模块只做 model → ag-ui 的展示映射。
// 前端用 @assistant-ui/react-ag-ui 的 fromAgUiMessages 还原为 assistant-ui 消息。
import type {
  AssistantMessage,
  Interrupt,
  Message as AgUiMessage,
  ReasoningMessage,
  SystemMessage,
  ToolCall,
  ToolMessage,
  UserMessage
} from '@ag-ui/core';
import type {ReasoningPart, TextPart, ToolApprovalRequest, ToolCallPart, ToolResultPart} from '@ai-sdk/provider-utils';
import type {ModelMessage} from '@vico/model';
import type {Message} from '@vico/thread';
import {modelContentToAguiContent} from './model-to-agui-content.js';
import {type ModelUserContentParts} from './agui-to-model-content.js';
import {toolApprovalInterrupt} from './interrupts.js';

/** 提取 parts 数组中的纯文本 */
function textOf(content: Extract<ModelMessage['content'], unknown[]>): string {
  return content
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** tool-result output → 文本（text 原样，其余 JSON 序列化） */
function toolOutputText(output: unknown): { text: string; isError: boolean } {
  const o = output as { type?: string; value?: unknown };
  if (o?.type === 'text') return { text: String(o.value ?? ''), isError: false };
  if (o?.type === 'error-text') return { text: String(o.value ?? ''), isError: true };
  if (o?.type === 'error-json') return { text: JSON.stringify(o.value), isError: true };
  if (o?.type === 'execution-denied') return { text: 'Tool execution denied', isError: true };
  return { text: o?.value !== undefined ? JSON.stringify(o.value) : JSON.stringify(output), isError: false };
}

/** 组装消息 metadata：透传自定义上下文字段，并附带所属 turnId（供前端按 turn 聚合/关联） */
function metadataOf(entry: Message): Record<string, unknown> | undefined {
  if (!entry.metadata && !entry.turnId) return undefined;
  return { ...entry.metadata, turnId: entry.turnId };
}

/**
 * 在消息 metadata 上附加工具审批 interrupts。
 *
 * 前端 fromAgUiMessages 从 wire 消息的 metadata.custom.agui.interrupts 还原 pending 审批态；
 * 无 interrupts 时原样返回 base metadata，避免多余字段。
 *
 * @param metadata - 基础 metadata（可含 usage / turnId 等）
 * @param interrupts - 待审批调用对应的 ag-ui interrupts
 * @returns 合并后的 metadata；无 interrupts 时返回 base metadata 本身
 */
function withInterrupts(metadata: Record<string, unknown> | undefined, interrupts: Interrupt[]): Record<string, unknown> | undefined {
  if (interrupts.length === 0) return metadata;

  const custom = (metadata?.custom as Record<string, unknown> | undefined) ?? {};
  const agui = (custom.agui as Record<string, unknown> | undefined) ?? {};

  return {
    ...(metadata ?? {}),
    custom: {
      ...custom,
      agui: {
        ...agui,
        interrupts,
      },
    },
  };
}

/**
 * 收集已解析（已有 tool-result）的工具调用 id。
 *
 * 审批通过/拒绝后都会落一条 tool-result 消息，故仍有 tool-approval-request 标记、
 * 但已被 tool-result 覆盖的调用不应再渲染为 pending 审批态。
 *
 * @param entries - 线程存储返回的消息条目
 * @returns 已有 tool-result 的 toolCallId 集合
 */
function resolvedToolCallIds(entries: Message[]): Set<string> {
  const ids = new Set<string>();

  for (const entry of entries) {
    if (entry.role !== 'tool' || typeof entry.content === 'string') continue;
    for (const part of entry.content.filter((p): p is ToolResultPart => p.type === 'tool-result')) {
      ids.add(part.toolCallId);
    }
  }

  return ids;
}

/**
 * ThreadStore Message → ag-ui Message（历史展示用）。
 *
 * - assistant 的 reasoning part → 独立 ReasoningMessage（fromAgUiMessages 会折叠回 assistant）
 * - assistant 的 tool-call part → AssistantMessage.toolCalls
 * - assistant 的 tool-approval-request part → 消息 metadata 的 interrupts（前端还原 pending 审批态）
 * - tool 消息的 tool-result part → ToolMessage（error 走 error 字段）
 *
 * 每条产出的 ag-ui 消息 metadata 均附带所属 turnId，前端据此按 turn 聚合展示。
 *
 * @param entries - 线程存储返回的消息条目（content 为原生 ModelMessage.content）
 * @returns 可直接由前端 fromAgUiMessages 还原的 ag-ui 消息数组
 */
export function toAgUiMessages(entries: Message[]): AgUiMessage[] {
  const result: AgUiMessage[] = [];
  // 已解析的调用（已有 tool-result）不再渲染为 pending 审批态
  const resolvedIds = resolvedToolCallIds(entries);

  for (const entry of entries) {
    const content = entry.content;
    const metadata = metadataOf(entry);

    if (typeof content === 'string') {
      result.push({
        id: entry.id,
        role: entry.role as AgUiMessage['role'],
        content,
        metadata,
      } as AgUiMessage);
      continue;
    }

    switch (entry.role) {
      case 'user': {
        const msg: UserMessage = {
          id: entry.id,
          role: 'user',
          // user 消息 content 实为 TextPart/FilePart，完整映射保留媒体 part
          content: modelContentToAguiContent(content as ModelUserContentParts),
          metadata,
        };
        result.push(msg);
        break;
      }

      case 'system': {
        const msg: SystemMessage = {
          id: entry.id,
          role: 'system',
          content: textOf(content),
          metadata,
        };
        result.push(msg);
        break;
      }

      case 'assistant': {
        const reasoningParts = content.filter((p): p is ReasoningPart => p.type === 'reasoning');
        const text = textOf(content);

        // tool-call part → 记录 toolName/input，供 toolCalls 与审批 interrupt 复用
        const callParts = content.filter((p): p is ToolCallPart => p.type === 'tool-call');
        const toolCalls: ToolCall[] = callParts.map((tc) => ({
          id: tc.toolCallId,
          type: 'function' as const,
          function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
        }));

        // 待审批调用：tool-approval-request part → interrupts，挂到消息 metadata
        // （前端 fromAgUiMessages 据此还原 pending 审批态，避免卡在审批阶段的历史态丢失；
        //   已落 tool-result 的调用表示审批已通过/拒绝，不再渲染为 pending）
        const callById = new Map(callParts.map((tc) => [tc.toolCallId, tc]));
        const interrupts: Interrupt[] = content
          .filter((p): p is ToolApprovalRequest => p.type === 'tool-approval-request')
          .filter((req) => !resolvedIds.has(req.toolCallId))
          .map((req) => {
            const call = callById.get(req.toolCallId);
            return toolApprovalInterrupt(req.approvalId, req.toolCallId, call?.toolName ?? 'tool', call?.input);
          });
        const assistantMetadata = withInterrupts(metadata, interrupts);

        // reasoning → 独立 ReasoningMessage（置于 assistant 之前）
        for (const r of reasoningParts) {
          const msg: ReasoningMessage = {
            id: `${entry.id}:reasoning`,
            role: 'reasoning',
            content: r.text,
            metadata,
          };
          result.push(msg);
        }

        const msg: AssistantMessage = {
          id: entry.id,
          role: 'assistant',
          content: text,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          metadata: assistantMetadata,
        };
        result.push(msg);
        break;
      }

      case 'tool': {
        // tool-approval-response 由 fromAgUiMessages 无法还原，历史里忽略（审批态已随 checkpoint 恢复）
        for (const part of content.filter((p): p is ToolResultPart => p.type === 'tool-result')) {
          const { text, isError } = toolOutputText(part.output);
          const msg: ToolMessage = {
            id: entry.id,
            role: 'tool',
            content: text,
            toolCallId: part.toolCallId,
            ...(isError ? { error: text } : {}),
            metadata,
          };
          result.push(msg);
        }
        break;
      }

      default:
        // 未知角色静默跳过
        break;
    }
  }

  return result;
}
