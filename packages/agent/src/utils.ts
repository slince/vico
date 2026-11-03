import {TurnOutput} from "./turn-output.js";
import type {TurnResult} from "./loop-agent-options.js";
import type {ModelMessage} from '@ai-sdk/provider-utils';
import type {UserMessage} from '@vico/stream';
import {MemoryStore} from '@vico/memory';
import {ContextProcessor} from '@vico/context';
import {Skill} from '@vico/skill';
import {SystemPromptProcessor} from '@vico/context';
import {SkillProcessor} from '@vico/context';
import {WorkspaceToolProcessor} from '@vico/context';
import {MemoryProcessor} from '@vico/context';

/**
 * UserMessage 归一化为本轮输入消息组：
 * - `string` → 单条 user 消息（空串不注入消息）
 * - `ModelMessage[]` → 原样透传全部
 *
 * 审批决策以原生 tool-approval-response 消息 in-band 携带，由 LoopAgent.startTurn
 * 经 extractApprovalResponses 解析消费（见 @vico/model）。
 *
 * @param message - 两种形态的用户入参
 * @returns 本轮输入的 ModelMessage 数组（可为空数组）
 */
export async function normalizeUserMessage(message: UserMessage): Promise<ModelMessage[]> {
  if (typeof message === 'string') {
    return message ? [{ role: 'user', content: message }] : [];
  }
  return message;
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
  return output.result();
}


/** 组装默认上下文处理器管道：系统提示词 + Skill 目录 + 工作区过滤 + 记忆 */
export function createDefaultProcessors(skills: Skill[], memory: MemoryStore): ContextProcessor[] {
  return [
    new SystemPromptProcessor(),
    new SkillProcessor(skills),
    new WorkspaceToolProcessor(),
    new MemoryProcessor(memory),
  ];
}