// @vico/core - 原生 ModelMessage 工具函数：文本提取、消息构造、审批决策解析、ToolSet 转换
import type {JSONValue, ModelMessage, ToolSet} from 'ai';
import {tool} from 'ai';
import type {
  AssistantModelMessage,
  ReasoningPart,
  TextPart,
  ToolApprovalRequest,
  ToolApprovalResponse,
  ToolCallPart,
  ToolModelMessage,
  ToolResultOutput,
} from '@ai-sdk/provider-utils';
import type {Tool, ToolCall, ToolResult} from '../tool/types.js';
import type {ToolCallApproval} from '../agent/loop-agent-options.js';

/**
 * 消息 content 的原生 part 联合类型，覆盖 AI SDK 生成/历史场景中的主要 part。
 * 复用 @ai-sdk/provider-utils 的 TextPart / ReasoningPart，其余 part 以索引签名兜底。
 */
export type ContentPart = TextPart | ReasoningPart | ({ type: string; [key: string]: unknown } & Record<string, unknown>);

/**
 * 提取消息的纯文本内容（string content 直接返回，parts 拼接全部 text part）。
 */
export function getMessageText(msg: ModelMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

/**
 * 选取消息组中的"主用户消息"：最后一条 user 角色消息，无则取末条。
 * 供 thread 标题、tracer 记录、ctx.userMessage 等单消息语义场景使用。
 */
export function pickPrimaryUserMessage(messages: ModelMessage[]): ModelMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return messages[messages.length - 1];
}

/**
 * 从消息链收集所有 tool-call 的 id（含 providerExecuted 调用），用于识别孤儿 tool-result。
 *
 * @param messages - 待扫描的消息链
 * @returns tool-call id 集合
 */
function collectToolCallIds(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue;
    for (const part of msg.content) {
      if (part.type === 'tool-call') ids.add(part.toolCallId);
    }
  }
  return ids;
}

/**
 * 从消息链收集所有「已完成」的 toolCallId（存在配对 tool-result）。
 * 配对口径与 findUnpairedToolCalls 一致：role==='tool' 的 tool-result part。
 */
export function completedCallIds(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== 'tool') continue;
    for (const part of msg.content) {
      if (part.type === 'tool-result') ids.add(part.toolCallId);
    }
  }
  return ids;
}

/**
 * 防御性补全消息链，确保 assistant 的 tool-call 与 tool 消息的 tool-result 一一配对：
 * - tool-call 一律保留（模型决策不可丢）；
 * - 无对应 tool-result 的非 providerExecuted tool-call，补一条占位 error-text result
 *   （插在下一个 user/system 消息之前或链尾），避免 convertToLanguageModelPrompt 抛 MissingToolResultsError；
 * - 无对应 tool-call 的孤儿 tool-result 移除，避免 provider 校验报错。
 * provider 端执行的 tool-call（providerExecuted）由 provider 自行返回结果，不参与配对。
 * 返回新数组，不修改入参。
 *
 * @param messages - 待补全的消息链
 * @returns 补全后的消息链
 */
export function ensureToolCallConsistency(messages: ModelMessage[]): ModelMessage[] {
  // 第一遍：收集所有 tool-call id（含 providerExecuted），用于识别孤儿 tool-result
  const allCallIds = collectToolCallIds(messages);

  const cleaned: ModelMessage[] = [];
  // 尚未配对到 tool-result 的非 providerExecuted tool-call（id → toolName），按顺序补齐
  const pending = new Map<string, string>();

  // 为所有未配对的 tool-call 补占位 tool-result（一条 tool 消息承载多个 result）
  const flushPending = () => {
    if (pending.size === 0) return;
    const parts = [...pending.entries()].map(([toolCallId, toolName]) => ({
      type: 'tool-result' as const,
      toolCallId,
      toolName,
      output: { type: 'error-text' as const, value: 'Tool result missing' },
    }));
    cleaned.push({ role: 'tool', content: parts } as ModelMessage);
    pending.clear();
  };

  for (const msg of messages) {
    // 新的 user/system 消息前，先把前序未配对的 tool-call 补齐，避免跨轮配对断裂
    if (msg.role === 'user' || msg.role === 'system') {
      flushPending();
      cleaned.push(msg);
      continue;
    }
    if (typeof msg.content === 'string') {
      cleaned.push(msg);
      continue;
    }

    if (msg.role === 'assistant') {
      for (const part of msg.content) {
        if (part.type === 'tool-call' && !part.providerExecuted) {
          pending.set(part.toolCallId, part.toolName);
        }
      }
      cleaned.push(msg);
      continue;
    }

    if (msg.role === 'tool') {
      const remaining = msg.content.filter((part) => {
        if (part.type === 'tool-result') {
          if (!allCallIds.has(part.toolCallId)) return false; // 孤儿 tool-result 移除
          pending.delete(part.toolCallId); // 配对成功，不再补占位
          return true;
        }
        return true;
      });
      if (remaining.length > 0) {
        cleaned.push({ ...msg, content: remaining } as ModelMessage);
      }
      continue;
    }

    cleaned.push(msg);
  }

  flushPending();
  return cleaned;
}

/**
 * 构造原生 assistant 消息：推理 + 文本 + 工具调用 parts，并为待审批调用追加审批请求 part。
 * content 数组不能为空，兜底空文本。
 *
 * tool-approval-request part 是 tool-call part 的审批标记（二者共存，而非替代），
 * approvalId 复用 toolCallId（与引擎审批请求/响应的约定一致）；provider 转换时该标记
 * 会被剥离，仅用于与后续 tool-approval-response 配对，标记该调用无需 tool-result 即可通过校验。
 *
 * @param text - 模型生成的文本内容
 * @param toolCalls - 模型请求的工具调用
 * @param reasoning - 模型推理/思考内容（如 o1/DeepSeek-R1 的内部推理链）
 * @param pendingApprovalCalls - 待客户端审批的工具调用（在对应 tool-call 后追加审批标记 part）
 */
export function buildAssistantMessage(
  text: string,
  toolCalls: ToolCall[],
  reasoning: string,
  pendingApprovalCalls: ToolCall[] = [],
): AssistantModelMessage {
  const parts: Array<ReasoningPart | TextPart | ToolCallPart | ToolApprovalRequest> = [];
  if (reasoning) parts.push({ type: 'reasoning', text: reasoning });
  if (text) parts.push({ type: 'text', text });

  // 待审批调用 id 集合，用于在对应 tool-call 后追加审批标记 part
  const pendingIds = new Set(pendingApprovalCalls.map((tc) => tc.id));

  for (const tc of toolCalls) {
    parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.args });
    if (pendingIds.has(tc.id)) {
      parts.push({ type: 'tool-approval-request', approvalId: tc.id, toolCallId: tc.id });
    }
  }
  if (parts.length === 0) parts.push({ type: 'text', text: '' });
  return { role: 'assistant', content: parts };
}

/**
 * 构造原生 tool 消息：Vico ToolResult → tool-result part。
 * 成功时保留原生输出类型（string → text，其余 JSON 值 → json），失败 → error-text。
 *
 * @param result - Vico 工具执行结果
 */
export function buildToolResultMessage(result: ToolResult): ToolModelMessage {
  const output = resolveToolOutput(result);

  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: result.callId,
      toolName: result.name,
      output,
    }],
  };
}

/** 将 ToolResult 转为原生 ToolResultOutput：成功 text/json，失败 error-text。 */
function resolveToolOutput(result: ToolResult): ToolResultOutput {
  if (result.status === 'success') {
    if (typeof result.output === 'string') {
      return { type: 'text', value: result.output };
    }
    return { type: 'json', value: result.output as JSONValue };
  }

  if (result.error instanceof Error) {
    return { type: 'error-text', value: result.error.message };
  }
  return { type: 'error-text', value: result.error ?? 'tool execution failed' };
}

/**
 * 从消息组解析原生 tool-approval-response part 为审批决策，并剔除审批 part。
 * 审批语义由引擎消费（checkpoint resume），不进入发给模型的消息链；
 * 同一 toolCallId 后出现的决策覆盖先前的；parts 清空的消息整条移除。
 *
 * @param messages - 本轮输入消息组
 * @returns decisions（解析出的决策）+ rest（剔除审批 part 后的其余消息）
 */
export function extractApprovalResponses(messages: ModelMessage[]): { decisions: Map<string, ToolCallApproval>; rest: ModelMessage[] } {
  const decisionMap = new Map<string, ToolCallApproval>();
  const rest: ModelMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      rest.push(msg);
      continue;
    }
    let hasApproval = false;
    const remaining = msg.content.filter((part) => {
      if (part.type === 'tool-approval-response') {
        const p = part as ToolApprovalResponse;
        decisionMap.set(p.approvalId, {
          toolCallId: p.approvalId,
          approved: p.approved,
          scope: 'turn',
          reason: p.reason,
        });
        hasApproval = true;
        return false;
      }
      return true;
    });
    if (hasApproval && remaining.length === 0) continue; // 纯审批消息剔除
    rest.push(hasApproval ? ({ role: msg.role, content: remaining } as ModelMessage) : msg);
  }

  return {
    decisions: decisionMap,
    rest,
  };
}

/**
 * Vico Tool[] → ai ToolSet（供 prepareTools 转换为 provider 工具格式）。
 * 审批/策略元数据不进入 ToolSet，由 Vico loop 自行管理。
 */
export function toToolSet(tools: Tool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.inputSchema })]),
  );
}
