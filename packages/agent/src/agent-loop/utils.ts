import {TurnOutput} from "./turn-output.js";
import {Agent} from "./agent.js";
import {AgentLoop} from "./agent-loop.js";
import type {ContextProcessor} from "./context-processors/context-processor.js";
import {SystemPromptProcessor} from "./context-processors/system-prompt-processor.js";
import {SkillProcessor} from "./context-processors/skill-processor.js";
import {MemoryProcessor} from "./context-processors/memory-processor.js";
import {WorkspaceToolProcessor} from "./context-processors/workspace-tool-processor.js";
import {TurnResult} from "./agent-loop-options.js";
import type {ToolApproval} from "./agent-loop-options.js";
import type {Message} from '../thread/thread-store.js';
import type { ModelMessage, UIMessage } from 'ai';
import {convertToModelMessages, validateUIMessages} from 'ai';
import type {UserMessage} from '../stream/types.js';
import {buildApprovalResponseMessage} from '../model/message-utils.js';
import {SkillSettings} from "./create-agent.js";
import {resolve} from "node:path";
import {homedir} from "node:os";

/**
 * ThreadStore Message → 原生 ModelMessage（content 反序列化）。
 * 解析失败时按纯文本内容兜底（防御历史脏数据）。
 */
export function toModelMessages(entries: Message[]): ModelMessage[] {
  return entries.map((e) => {
    let content: unknown;
    try {
      content = JSON.parse(e.content);
    } catch {
      content = e.content;
    }
    return { role: e.role, content } as ModelMessage;
  });
}

/**
 * 原生 ModelMessage → ThreadStore 持久化字段（content 序列化）。
 */
export function fromModelMessage(msg: ModelMessage): { role: string; content: string } {
  return { role: msg.role, content: JSON.stringify(msg.content) };
}

/** UIMessage part 是否为审批响应（扩展 part 或原生 approval-responded 状态的 tool part） */
function isApprovalPart(part: Record<string, unknown>): boolean {
  return part.type === 'tool-approval-response' || part.state === 'approval-responded';
}

/**
 * 从 UIMessage[] 提取审批决策，兼容两种来源：
 * 1. Vico 客户端扩展 part：`{type:'tool-approval-response', approvalId, approved}`（approvalId 即 toolCallId）
 * 2. AI SDK 原生形态：ToolUIPart `state === 'approval-responded'`，决策挂在 `part.approval.approved`
 * 同一 toolCallId 后出现的决策覆盖先前的；无审批 part 时返回 undefined。
 */
export function extractApprovalDecisions(messages: UIMessage[]): ToolApproval[] | undefined {
  const decisions = new Map<string, boolean>();
  for (const msg of messages) {
    for (const part of msg.parts as Array<Record<string, unknown>>) {
      // 来源 1：扩展 part（approvalId 复用 toolCallId）
      if (part.type === 'tool-approval-response' && typeof part.approvalId === 'string') {
        decisions.set(part.approvalId, part.approved === true);
        continue;
      }
      // 来源 2：原生 tool part 的 approval-responded 状态
      if (part.state === 'approval-responded' && typeof part.toolCallId === 'string') {
        const approval = part.approval as { approved?: boolean } | undefined;
        decisions.set(part.toolCallId, approval?.approved === true);
      }
    }
  }
  if (decisions.size === 0) return undefined;
  return [...decisions].map(([toolCallId, approved]) => ({ toolCallId, approved }));
}

/**
 * UserMessage 归一化为本轮输入消息组（审批决策以原生 tool-approval-response 消息 in-band 携带）：
 * - `string` → 单条 user 消息（空串不注入消息）
 * - `UIMessage[]`（按首元素 `parts` 字段判别）→ 提取 UI 层审批（扩展 part / 原生 approval-responded
 *   状态）合成原生审批 tool 消息并剥离原 part，再 validateUIMessages + convertToModelMessages 取最后一条
 *   （历史由 Memory 注入，useChat 全量历史不重复入库）；审批-only 入参仅返回审批消息，不注入空 user 消息
 * - `ModelMessage[]` → 原样透传全部（调用方可直接携带原生 tool-approval-response 消息）
 *
 * 审批决策由 AgentLoop.resumeTurn 从消息组中解析消费（见 extractApprovalResponses）。
 *
 * @param message - 三种形态的用户入参
 * @returns 本轮输入的 ModelMessage 数组（可为空数组）
 */
export async function normalizeUserMessage(message: UserMessage): Promise<ModelMessage[]> {
  if (typeof message === 'string') {
    return message ? [{ role: 'user', content: message }] : [];
  }
  if (message.length === 0) return [];
  // UIMessage 必有 parts 字段，ModelMessage 必有 content 字段
  if ('parts' in message[0]) {
    const uiMessages = message as UIMessage[];
    const decisions = extractApprovalDecisions(uiMessages);
    // UI 层审批语义转为原生 in-band 审批消息，置于本轮消息组首位
    const approvalMessages: ModelMessage[] = decisions?.length ? [buildApprovalResponseMessage(decisions)] : [];
    // 剥离审批 part：扩展 part 非原生类型（validateUIMessages 不认识），原生 approval-responded
    // 的语义已合成为审批消息；parts 清空的消息整条移除
    const stripped = uiMessages
      .map((m) => ({ ...m, parts: m.parts.filter((p) => !isApprovalPart(p as Record<string, unknown>)) }))
      .filter((m) => m.parts.length > 0);
    if (stripped.length === 0) return approvalMessages;
    const validated = await validateUIMessages({ messages: stripped });
    const converted = await convertToModelMessages(validated, { ignoreIncompleteToolCalls: true });
    const last = converted[converted.length - 1];
    return last ? [...approvalMessages, last] : approvalMessages;
  }
  return message as ModelMessage[];
}

/**
 * 消费 TurnOutput 并返回最终结果（丢弃流数据）。
 *
 * @param output - TurnOutput 实例
 * @returns turn 最终结果
 */
export async function collectTurnResult(
  output: TurnOutput,
): Promise<TurnResult> {
  return output.result;
}


/**
 * 为 Agent 构建 AgentLoop，组装处理器管道和工具代理。
 *
 * @param agent - Agent 实例
 * @returns 配置好的 AgentLoop 实例
 */
export function buildLoop(agent: Agent): AgentLoop {
  // prompt context processor
  const processors: ContextProcessor[] = [
    new SystemPromptProcessor(),
    new SkillProcessor(agent.skills),
    new WorkspaceToolProcessor(),
  ];

  if (agent.memory) {
    processors.push(new MemoryProcessor(agent.memory));
  }

  return new AgentLoop({ agent, processors });
}

/** 各产品全局 Skills 默认目录 */
export const COMPATIBLE_SKILL_ROOTS = [
  '.claude/skills',
  '.openclaw/skills',
  '.hermes/skills',
  '.agents/skills',
];

/**
 * 汇总 SkillSettings 中所有待扫描目录
 * @param settings - Skill 扫描配置
 * @returns 所有待扫描的绝对路径列表
 */
export function collectSkillDirs(settings: SkillSettings): string[] {
  const dirs: string[] = [];
  if (settings.skillDirs) {
    dirs.push(...settings.skillDirs);
  }
  if (settings.compatible) {
    const home = homedir();
    for (const rel of COMPATIBLE_SKILL_ROOTS) {
      dirs.push(resolve(home, rel));
    }
  }
  return dirs;
}
