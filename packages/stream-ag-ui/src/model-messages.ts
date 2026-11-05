// @vico/stream-ag-ui - ag-ui 消息/resume → 引擎 ModelMessage 转换（本轮输入）。
//
// 路由层把前端 ag-ui RunAgentInput 解析后，经本模块转换为引擎入参 ModelMessage[]：
// - messages → 全部消息逐个映射为 ModelMessage（user/assistant/tool/system/developer；
//   reasoning 折叠回紧随的 assistant，activity 丢弃）
// - resume → tool-approval-response（in-band 承载审批决策）
import type {ResumeEntry, RunAgentInput} from '@ag-ui/core';
import type {ModelMessage} from '@vico/model';
import {SESSION_SCOPE_REASON} from '@vico/tool';
import {aguiContentToModelContent, aguiContentToText} from './content-parts.js';

/** ag-ui resume 决议 payload（工具审批：approved / reason / scope） */
interface ApprovalResumePayload {
  approved?: boolean;
  reason?: string;
  scope?: 'turn' | 'session';
}

/** ModelMessage assistant 消息的 content parts 数组（text / reasoning / tool-call 等） */
type AssistantContentParts = Extract<Extract<ModelMessage, { role: 'assistant' }>['content'], unknown[]>;

/**
 * RunAgentInput.resume → ModelMessage（tool-approval-response part，in-band 承载审批决策）。
 * approvalId 复用 toolCallId（引擎约定）；scope:'session' 经 SESSION_SCOPE_REASON 标记。
 *
 * @param resume - ag-ui 恢复决议条目（interrupt 的响应）
 * @returns 单条 tool 角色的 ModelMessage，parts 为 tool-approval-response
 */
export function resumeToModelMessages(resume: ResumeEntry[]): ModelMessage[] {
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

/** 安全解析工具调用参数：合法 JSON → 对象，非法保留原文（ag-ui 协议允许模型输出非 JSON 参数） */
function parseToolCallInput(argumentsStr: string): unknown {
  try {
    return JSON.parse(argumentsStr);
  } catch {
    return argumentsStr;
  }
}

/**
 * ag-ui 消息 → 本轮输入 ModelMessage（全部消息逐个映射）。
 *
 * 角色映射：
 * - system / developer → system（ModelMessage 无 developer 角色，语义归入 system）
 * - user → user（content 提取纯文本）
 * - assistant → assistant（reasoning 折叠回 reasoning part + text + tool-call parts）
 * - tool → tool（tool-result part；toolName 从先前 assistant tool-call 回填，error 走 error-text）
 * - reasoning → 缓冲并折叠进紧随的 assistant（toAgUiMessages 会把它拆到 assistant 之前）
 * - activity → 丢弃（结构化进度，非对话内容）
 *
 * @param messages - RunAgentInput.messages（ag-ui 消息数组）
 * @returns 全部消息映射出的 ModelMessage 数组
 */
export function aguiMessagesToModelMessages(messages: RunAgentInput['messages']): ModelMessage[] {
  const result: ModelMessage[] = [];
  // assistant tool-call 的 toolCallId → toolName：ag-ui ToolMessage 不携带 toolName，需回填
  const toolNames = new Map<string, string>();
  // 前序 ReasoningMessage 缓冲，折叠回紧随其后的 assistant 消息
  let pendingReasoning: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        result.push({ role: 'system', content: msg.content });
        break;

      case 'developer':
        // ModelMessage 无 developer 角色，归入 system（最接近的系统指令语义）
        result.push({ role: 'system', content: msg.content });
        break;

      case 'user':
        result.push({ role: 'user', content: aguiContentToModelContent(msg.content) });
        break;

      case 'assistant': {
        const parts: AssistantContentParts = [];
        // 折叠缓冲的 reasoning（toAgUiMessages 会把它拆成独立 ReasoningMessage 置于 assistant 之前）
        for (const r of pendingReasoning) parts.push({ type: 'reasoning', text: r });
        pendingReasoning = [];
        if (msg.content) parts.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls ?? []) {
          toolNames.set(tc.id, tc.function.name);
          parts.push({
            type: 'tool-call',
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: parseToolCallInput(tc.function.arguments),
          });
        }
        result.push({ role: 'assistant', content: parts });
        break;
      }

      case 'tool': {
        const text = aguiContentToText(msg.content);
        result.push({
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: msg.toolCallId,
            toolName: toolNames.get(msg.toolCallId) ?? '',
            output: msg.error ? { type: 'error-text', value: text } : { type: 'text', value: text },
          }],
        });
        break;
      }

      case 'reasoning':
        pendingReasoning.push(msg.content);
        break;

      case 'activity':
        // 结构化进度消息，非对话内容，不进模型上下文
        break;
    }
  }

  return result;
}
