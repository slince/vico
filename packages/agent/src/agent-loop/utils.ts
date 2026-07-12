import {TurnOutput} from "./turn-output.js";
import {Agent} from "./agent.js";
import {AgentLoop} from "./agent-loop.js";
import type {ContextProcessor} from "./context-processors/context-processor.js";
import {SystemPromptProcessor} from "./context-processors/system-prompt-processor.js";
import {SkillProcessor} from "./context-processors/skill-processor.js";
import {MemoryProcessor} from "./context-processors/memory-processor.js";
import {WorkspaceToolProcessor} from "./context-processors/workspace-tool-processor.js";
import {TurnResult} from "./agent-loop-options.js";
import type {Message} from '../thread/thread-store.js';
import type {MessageRole, ModelMessage} from '../model/types.js';
import {ToolCall} from "../tool/types.js";
import {SkillSettings} from "./create-agent.js";
import {resolve} from "node:path";
import {homedir} from "node:os";

/**
 * 将 ThreadStore Message 数组转换为模型可用的 ModelMessage 数组。
 *
 * @param entries - ThreadStore 中的 Message 列表
 * @returns 模型格式的消息数组
 */
export function toModelMessages(entries: Message[]): ModelMessage[] {
  return entries.map((e) => {
    const msg: ModelMessage = { role: e.role as MessageRole, content: e.content };
    if (e.toolCallId) msg.toolCallId = e.toolCallId;
    if (e.toolCalls) msg.toolCalls = e.toolCalls as ToolCall[];
    return msg;
  });
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
