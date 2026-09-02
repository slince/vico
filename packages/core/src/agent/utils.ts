import {TurnOutput} from "./turn-output.js";
import type {TurnResult} from "./loop-agent-options.js";
import type {ModelMessage, UIMessage} from 'ai';
import {convertToModelMessages, validateUIMessages} from 'ai';
import type {UserMessage} from '../stream/types.js';
import type {ToolCall} from "../tool/types.js";
import {getToolCalls} from "../model/message-utils.js";
import {SkillSettings} from "./create-agent.js";
import {resolve} from "node:path";
import {homedir} from "node:os";

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
 * 审批决策由 LoopAgent.resumeTurn 从消息组中解析消费（见 extractApprovalResponses）。
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
    const messages = message as UIMessage[];

    const validated = await validateUIMessages({ messages });
    const converted = await convertToModelMessages(validated, { ignoreIncompleteToolCalls: true });
    const last = converted[converted.length - 1];

    return last ? [last] : [];
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

/**
 * 消息链核对（防线②）：找到最后一条含 toolCalls 的 assistant 消息，
 * 检查其调用是否全部在链内配对到 tool_result。
 *
 * - 全部配对 → 返回 null：该 step 已完成，恢复时直接从 stepIndex 续跑，不重发工具。
 * - 存在未配对 → 返回该 assistant 消息索引与未配对 callId 列表：
 *   崩溃发生在「副作用已发生但结果未落链」窗口，恢复时截断到该消息之前，
 *   让模型基于一致链重新决策（不盲目重执行 mutation 工具）。
 *
 * @param messages - 从 threadStore 恢复出的模型消息链
 * @returns 未配对的 assistant 消息信息；无未配对时返回 null
 */
export function findUnpairedToolCalls(messages: ModelMessage[]): { assistantIndex: number; unpairedCallIds: string[] } | null {
  const toolResultIds = (msg: ModelMessage): string[] => {
    if (msg.role !== 'tool') return [];
    return msg.content
      .filter((p) => p.type === 'tool-result')
      .map((p) => p.toolCallId);
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const calls = getToolCalls(msg);
    if (calls.length === 0) continue;
    const resultIds = new Set<string>();
    for (let j = i + 1; j < messages.length; j++) {
      for (const id of toolResultIds(messages[j])) resultIds.add(id);
    }
    const unpaired = calls.filter((c) => !resultIds.has(c.id)).map((c) => c.id);
    return unpaired.length > 0 ? { assistantIndex: i, unpairedCallIds: unpaired } : null;
  }
  return null;
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
 * 差集恢复：计划执行清单 − 消息链中已完成（有 tool-result）的调用 = 仍需补跑的调用。
 * 已完成的绝不重跑；清单外 id 不参与结果。
 */
export function diffRemaining(planned: ToolCall[], messages: ModelMessage[]): ToolCall[] {
  const done = completedCallIds(messages);
  return planned.filter((c) => !done.has(c.id));
}
