// @vico/agent - AgentRuntime module type definitions
import type { AgentConfig } from '../contracts/agent.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';
import type { Skill } from '../skill/types.js';
import type { ToolSpec } from '../contracts/tool.js';
import type { MemoryStore } from '../memory/types.js';

/** Agent — 配置 + 运行时 loop + 绑定（memory/skills/tools） */
export class Agent {
  readonly config: AgentConfig;
  readonly loop: AgentLoop;
  readonly skills: Skill[];
  readonly tools: ToolSpec[];
  readonly memory?: MemoryStore;

  constructor(params: {
    config: AgentConfig;
    loop: AgentLoop;
    skills?: Skill[];
    tools?: ToolSpec[];
    memory?: MemoryStore;
  }) {
    this.config = params.config;
    this.loop = params.loop;
    this.skills = params.skills ?? [];
    this.tools = params.tools ?? [];
    this.memory = params.memory;
  }
}

/** Agent 工厂函数 — 由外部注入，负责按配置组装 Agent */
export type AgentFactory = (config: AgentConfig) => Promise<Agent>;
