import {TurnOutput} from "./turn-output.js";
import type {TurnResult} from "./loop-agent-options.js";
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
export function fromModelMessage(msg: ModelMessage): Pick<Message, 'role'|'content'> {
  return { role: msg.role, content: JSON.stringify(msg.content) };
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
