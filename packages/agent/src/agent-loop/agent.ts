import type {LanguageModelV3} from '@ai-sdk/provider';
import {ModelClient} from '../model/model-client.js';
import type {AgentConfig} from './types.js';
import type {Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import type {AgentLoop} from './agent-loop.js';

/** Agent — 配置 + 运行时 loop + 绑定（memory/thread/skills/tools） */
export class Agent {
  readonly config: AgentConfig;
  readonly model: LanguageModelV3;
  readonly modelClient: ModelClient;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory?: MemoryStore;
  readonly thread: ThreadStore;

  /** AgentLoop 实例，由容器在构建时注入 */
  loop?: AgentLoop;

  constructor(params: {
    config: AgentConfig;
    model: LanguageModelV3;
    skills?: Skill[];
    tools?: Tool[];
    memory?: MemoryStore;
    thread: ThreadStore;
  }) {
    this.config = params.config;
    this.model = params.model;
    this.modelClient = new ModelClient(params.model);
    this.skills = params.skills ?? [];
    this.tools = params.tools ?? [];
    this.memory = params.memory;
    this.thread = params.thread;
  }

  getLoop(): AgentLoop {
    return this.loop!;
  }
}
