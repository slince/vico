// @vico/agent - Vico: one-shot wiring for all Agent services
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import type {AgentConfig, TurnEvent, TurnResult} from '../agent-loop/types.js';
import {Agent} from '../agent-loop/types.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import type {ModelClient, ModelClientFactory, ModelMessage} from '../model/types.js';
import {defaultModelFactory} from '../model/factory.js';
import type {ToolSource} from '../tool/types.js';
import {ToolBroker} from '../tool/tool-broker.js';
import {SkillManager} from '../skill/skill-manager.js';
import {FSSkillLoader} from '../skill/fs-skill-loader.js';
import {AgentLoop, collectTurnResult} from '../agent-loop/agent-loop.js';
import type {ContextProcessor} from '../prompt/context-processor.js';
import {SystemPromptProcessor} from '../prompt/system-prompt-processor.js';
import {SkillProcessor} from '../skill/skill-processor.js';
import type {SkillStore} from '../skill/types.js';
import {MemoryProcessor} from '../memory/memory-processor.js';
import {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import {InMemoryThreadStore} from '../thread/memory-thread-store.js';
import {MittEventRecorder} from '../observable/event-recorder.js';
import {InMemorySpanTracker} from '../observable/span-tracker.js';
import {createMemoryToolSource} from "../memory/memory-tool-source.js";
import {createBuiltInToolSource} from "../tool/builtin-tools-source.js";
import {createSkillToolSource} from "../skill/skill-tool-source.js";

export type { ModelClientFactory } from '../model/types.js';


type SkillSettings = {
  /** Vico 原生 Skill 扫描根目录 */
  skillDirs?: string[];
  /** 开启后自动扫描第三方 AI Agent 产品的全局 Skills（Claude、OpenClaw、Hermes、通用 agents） */
  compatible?: boolean;
}

type SkillOptions = SkillStore | SkillSettings

/** 各产品全局 Skills 默认目录 */
const COMPATIBLE_SKILL_ROOTS = [
  '.claude/skills',
  '.openclaw/skills',
  '.hermes/skills',
  '.agents/skills',
];

/** 汇总 SkillSettings 中所有待扫描目录 */
function collectSkillDirs(settings: SkillSettings): string[] {
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

/** Vico 配置选项 */
export interface VicoOptions {
  /** Skill 配置 */
  skills?: SkillOptions;
  /** 额外的工具来源 */
  toolSources?: ToolSource[];
  /** ModelClient 工厂（不传则使用 defaultModelFactory） */
  modelFactory?: ModelClientFactory;
  /** AgentRuntime LRU 缓存上限（默认 50） */
  maxCached?: number;
  /** 全局 MemoryStore（agent 自身未配置时使用） */
  memory?: MemoryStore;
  /** 全局 ThreadStore（agent 自身未配置时使用） */
  thread?: ThreadStore;
}

/** invoke 调用选项 */
export interface InvokeOptions {
  threadId?: string;
  [key: string]: unknown;
}

/**
 * Vico — 一键装配所有 Agent 服务。
 *
 * @example
 * ```ts
 * const vico = new Vico({ skillRoots: ['./skills'] });
 * await vico.init();
 *
 * // 创建 Agent 并注册到 Runtime
 * await vico.createAgent(config);
 *
 * // 一行对话
 * const result = await vico.invoke(config.id, 'Hello');
 * ```
 */
export class Vico {
  readonly events = new MittEventRecorder();
  readonly spanTracker = new InMemorySpanTracker();

  private readonly skillManager: SkillManager;
  private initialized = false;
  private options: VicoOptions;
  private readonly modelFactory: ModelClientFactory;
  readonly runtime: AgentRuntime;
  readonly memory: MemoryStore;
  readonly thread: ThreadStore;

  constructor(options: VicoOptions = {}) {
    this.options = options;
    this.modelFactory = options.modelFactory ?? defaultModelFactory;
    this.runtime = new AgentRuntime(this.options.maxCached);
    this.memory = options.memory ?? new MemoryStore();
    this.thread = options.thread ?? new InMemoryThreadStore();
    this.skillManager = new SkillManager(new FSSkillLoader());
  }

  /** 初始化：发现 Skill、注册 skill 工具 */
  async init(): Promise<void> {
    if (this.options.skills && 'skillDirs' in this.options.skills) {
      const dirs = collectSkillDirs(this.options.skills);
      if (dirs.length > 0) {
        await this.skillManager.discover(dirs);
      }
    }
    this.initialized = true;
  }

  /** 构建 Agent 并注册到 Runtime */
  async createAgent(config: AgentConfig): Promise<Agent> {
    const mc = this.modelFactory(config.model);
    const agent = await this.buildAgent(config, mc);
    this.runtime.register(agent);
    return agent;
  }

  /**
   * 创建单个 Agent（无缓存），绑定 skills / tools。
   */
  private async buildAgent(config: AgentConfig, model: ModelClient): Promise<Agent> {
    if (!this.initialized) {
      throw new Error('Vico not initialized. Call await vico.init() first.');
    }

    // 加载 agent 绑定的 tools 和 skills
    const tools = config.tools ? await config.tools.load() : []

    const skills = config.skills ? await config.skills.load() : []

    const memory = config.memory ?? this.memory;
    const thread = config.thread ?? this.thread;

    const agent = new Agent({
      config,
      model,
      skills,
      tools,
      memory,
      thread,
    });

    agent.loop = this.buildLoop(agent);

    return agent;
  }

  /** 为 Agent 构建 AgentLoop */
  private buildLoop(agent: Agent): AgentLoop {
    const memory = agent.memory ?? this.memory;

    // prompt context processor
    const processors: ContextProcessor[] = [
      new SystemPromptProcessor(),
      new SkillProcessor(agent.skills),
    ];

    const toolBroker = new ToolBroker();

    // 如果没有预定义就用 vico的
    if (!agent.tools ) {
      if (this.options.toolSources) {
        for (const source of this.options.toolSources) {
          toolBroker.addSource(source);
        }
      }
      toolBroker.addSource(createSkillToolSource(this.skillManager));
    }

    if (memory) {
      processors.push(new MemoryProcessor(memory));
      toolBroker.addSource(createMemoryToolSource(memory))
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
      events: this.events,
      spanTracker: this.spanTracker,
    });
  }

  /**
   * 一行对话：从 Runtime 中查找 Agent，发送消息并返回结果。
   *
   * @example
   * ```ts
   * await vico.createAgent(config);
   * const result = await vico.invoke(config.id, 'Hello!');
   * ```
   */
  async invoke(agentId: string, message: string, options?: InvokeOptions): Promise<TurnResult> {
    const agent = this.runtime.getAgent(agentId);
    if (!agent) {
      throw new Error(
        `Agent "${agentId}" not found in runtime. Create it first via vico.createAgent().`,
      );
    }

    const userMessage: ModelMessage = { role: 'user', content: message };
    const threadId = options?.threadId ?? `invoke-${agentId}-${Date.now()}`;

    return collectTurnResult(agent.getLoop().runTurn(
      threadId,
      [],
      userMessage,
      new AbortController().signal,
    ));
  }

  /** 流式对话 — 返回异步迭代器，逐条获得过程事件 */
  stream(agentId: string, message: string, options?: InvokeOptions): AsyncGenerator<TurnEvent, TurnResult> {
    const agent = this.runtime.getAgent(agentId);
    if (!agent) {
      throw new Error(
        `Agent "${agentId}" not found in runtime. Create it first via vico.createAgent().`,
      );
    }

    const userMessage: ModelMessage = { role: 'user', content: message };
    const threadId = options?.threadId ?? `invoke-${agentId}-${Date.now()}`;

    return agent.getLoop().runTurn(threadId, [], userMessage, new AbortController().signal);
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }
}
