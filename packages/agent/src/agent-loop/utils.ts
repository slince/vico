import {TurnResult} from "./types.js";
import {TurnOutput} from "./turn-output.js";
import {Agent} from "./agent.js";
import {AgentLoop} from "./agent-loop.js";
import type {ContextProcessor} from "./context-processors/context-processor.js";
import {SystemPromptProcessor} from "./context-processors/system-prompt-processor.js";
import {SkillProcessor} from "./context-processors/skill-processor.js";
import {ToolBroker} from "../tool/tool-broker.js";
import {MemoryProcessor} from "./context-processors/memory-processor.js";
import {createUpdateWorkingMemoryTool} from "../memory/tool/working-memory-tool.js";
import {baseBuiltinTools} from "../tool/builtin/index.js";

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
  ];

  const toolBroker = new ToolBroker();

  if (agent.memory) {
    processors.push(new MemoryProcessor(agent.memory));
    toolBroker.registerAll([createUpdateWorkingMemoryTool(agent.memory.working)]);
  }

  // 注册自定义的tool
  if (agent.tools.length > 0) {
    toolBroker.registerAll(agent.tools);
  }

  toolBroker.registerAll(baseBuiltinTools);

  return new AgentLoop({
    agent,
    toolBroker,
    processors,
  });
}
