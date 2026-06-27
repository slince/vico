import {TurnResult} from "./types.js";
import {TurnOutput} from "./turn-output.js";
import {Agent} from "./agent.js";
import {AgentLoop} from "./agent-loop.js";
import type {ContextProcessor} from "../prompt/context-processor.js";
import {SystemPromptProcessor} from "../prompt/system-prompt-processor.js";
import {SkillProcessor} from "../skill/skill-processor.js";
import {ToolBroker} from "../tool/tool-broker.js";
import {MemoryProcessor} from "../memory/memory-processor.js";
import {createMemoryToolSource} from "../memory/working/memory-tool-source.js";
import {createBuiltInToolSource} from "../tool/builtin-tools-source.js";

/** 消费 TurnOutput 并返回最终结果（丢弃流数据） */
export async function collectTurnResult(
  output: TurnOutput,
): Promise<TurnResult> {
  return output.result;
}


/** 为 Agent 构建 AgentLoop */
export function buildLoop(agent: Agent): AgentLoop {
  // prompt context processor
  const processors: ContextProcessor[] = [
    new SystemPromptProcessor(),
    new SkillProcessor(agent.skills),
  ];

  const toolBroker = new ToolBroker();

  if (agent.memory) {
    processors.push(new MemoryProcessor(agent.memory));
    toolBroker.addSource(createMemoryToolSource(agent.memory))
  }

  // 注册自定义的tool
  if (agent.tools) {
    toolBroker.addSource({
      name: "primary",
      list: async () => agent.tools
    })
  }

  toolBroker.addSource(createBuiltInToolSource())

  return new AgentLoop({
    agent,
    toolBroker,
    processors,
  });
}
