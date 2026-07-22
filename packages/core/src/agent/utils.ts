import {TurnOutput} from "./turn-output.js";
import {Agent} from "./agent.js";
import {AgentLoop} from "./agent-loop.js";
import type {ContextProcessor} from "./context-processors/context-processor.js";
import {SystemPromptProcessor} from "./context-processors/system-prompt-processor.js";
import {SkillProcessor} from "./context-processors/skill-processor.js";
import {MemoryProcessor} from "./context-processors/memory-processor.js";
import {WorkspaceToolProcessor} from "./context-processors/workspace-tool-processor.js";
import type {ToolApproval} from "./agent-loop-options.js";
import {TurnResult} from "./agent-loop-options.js";
import type {Message} from '../thread/thread-store.js';
import type {ModelMessage, UIMessage} from 'ai';
import {convertToModelMessages, validateUIMessages} from 'ai';
import type {UserMessage} from '../stream/types.js';
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

/**
 * 从 UIMessage[] 提取审批决策（Vico 客户端扩展 part：`{type:'tool-approval-response', approvalId, approved}`）。
 * 同一 toolCallId 后出现的决策覆盖先前的；无审批 part 时返回 undefined。
 */
export function extractApprovalDecisions(messages: UIMessage[]): ToolApproval[] | undefined {
  const decisions = new Map<string, boolean>();
  for (const msg of messages) {
    for (const part of msg.parts as Array<Record<string, unknown>>) {
      if (part.type === 'tool-approval-response' && typeof part.approvalId === 'string') {
        decisions.set(part.approvalId, part.approved === true);
      }
    }
  }
  if (decisions.size === 0) return undefined;
  return [...decisions].map(([toolCallId, approved]) => ({ toolCallId, approved }));
}

/**
 * UserMessage 归一化为本轮输入消息组（审批决策以原生 tool-approval-response 消息 in-band 携带）：
 * - `string` → 单条 user 消息（空串不注入消息）
 * - `UIMessage[]`（按首元素 `parts` 字段判别）→ 提取审批扩展 part 合成原生审批 tool 消息，
 *   再剥离审批 part 后 validateUIMessages + convertToModelMessages 取最后一条
 *   （历史由 Memory 注入，useChat 全量历史不重复入库）；审批-only 入参仅返回审批消息，不注入空 user 消息
 * - `ModelMessage[]` → 原样透传全部
 *
 * 注：v7 validateUIMessages 已原生接受 tool-approval-response part，但 convertToModelMessages
 * 的 user/tool 分支会丢弃非 providerExecuted 的审批 part，仍需手动剥离+合成。
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
    const validated = await validateUIMessages({ messages: uiMessages });
    return await convertToModelMessages(validated, { ignoreIncompleteToolCalls: true });
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
