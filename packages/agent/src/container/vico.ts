// @vico/agent - Vico: one-shot wiring for all Agent services
import type {AgentConfig, TurnEvent, TurnResult} from '../agent-loop/types.js';
import {Agent} from '../agent-loop/types.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import type {ModelClient, ModelClientFactory, ModelMessage} from '../model/types.js';
import {defaultModelFactory} from '../model/factory.js';
import type {ToolSource} from '../tool/types.js';
import {ToolBroker} from '../tool/tool-broker.js';
import {SkillManager} from '../skill/skill-manager.js';
import {FSSkillLoader} from '../skill/fs-skill-loader.js';
import {createSkillToolSource} from '../skill/skill-tool-source.js';
import {AgentLoop, collectTurnResult} from '../agent-loop/agent-loop.js';
import type {ContextProcessor} from '../prompt/context-processor.js';
import {SystemPromptProcessor} from '../prompt/system-prompt-processor.js';
import {SkillProcessor} from '../skill/skill-processor.js';
import type {Skill} from '../skill/types.js';
import {MemoryProcessor} from '../memory/memory-processor.js';
import type {MemoryStore} from '../memory/memory-store.js';
import {MittEventRecorder} from '../observable/event-recorder.js';
import {InMemorySpanTracker} from '../observable/span-tracker.js';
import {CompositeHookRunner, type HookRunner} from '../hook/hook-runner.js';

export type { ModelClientFactory } from '../model/types.js';

/** Vico 配置选项 */
export interface VicoOptions {
  /** Skill 扫描根目录 */
  skillRoots?: string[];
  /** 额外的工具来源 */
  toolSources?: ToolSource[];
  /** 全局生命周期钩子 */
  hooks?: HookRunner[];
  /** ModelClient 工厂（不传则使用 defaultModelFactory） */
  modelFactory?: ModelClientFactory;
  /** AgentRuntime LRU 缓存上限（默认 50） */
  maxCached?: number;
  /** MemoryStore（提供时自动注入 MemoryProcessor + 注册 workMemory 工具） */
  memoryStore?: MemoryStore;
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
  readonly toolBroker = new ToolBroker();
  readonly hooks = new CompositeHookRunner();

  private readonly skillManager: SkillManager;
  private initialized = false;
  private options: VicoOptions;
  private readonly modelFactory: ModelClientFactory;
  readonly runtime: AgentRuntime;

  constructor(options: VicoOptions = {}) {
    this.options = options;
    this.modelFactory = options.modelFactory ?? defaultModelFactory;
    this.runtime = new AgentRuntime(this.options.maxCached);
    this.skillManager = new SkillManager(new FSSkillLoader());

    if (options.toolSources) {
      for (const source of options.toolSources) {
        this.toolBroker.addSource(source);
      }
    }

    if (options.hooks) {
      for (const hook of options.hooks) {
        this.hooks.register(hook);
      }
    }
  }

  /** 初始化：发现 Skill、注册 skill 工具 */
  async init(): Promise<void> {
    if (this.options.skillRoots?.length) {
      await this.skillManager.discover(this.options.skillRoots);
    }

    this.toolBroker.addSource(this.createSkillToolSource());
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
  private async buildAgent(config: AgentConfig, modelClient: ModelClient): Promise<Agent> {
    if (!this.initialized) {
      throw new Error('Vico not initialized. Call await vico.init() first.');
    }

    // 加载 agent 绑定的 tools 和 skills
    const boundTools = config.tools ? await config.tools.load() : await this.toolBroker.listTools({
      userId: '',
      agentId: config.id,
      threadId: '',
      workspace: '',
      hooks: [],
      awaitApproval: async () => ({ approved: true }),
      signal: new AbortController().signal,
    });

    const boundSkills = config.skills
      ? await config.skills.load()
      : this.skillManager.listAll();

    const agent = new Agent({
      config,
      skills: boundSkills,
      tools: boundTools,
    });

    agent.loop = this.buildLoop(agent, modelClient, boundSkills);

    return agent;
  }

  /** 为 Agent 构建 AgentLoop */
  private buildLoop(agent: Agent, modelClient: ModelClient, skills: Skill[]): AgentLoop {
    const memoryStore = agent.memory ?? this.options.memoryStore;

    const processors: ContextProcessor[] = [
      new SystemPromptProcessor(),
      new SkillProcessor(skills),
    ];
    if (memoryStore) {
      processors.push(new MemoryProcessor(memoryStore));
    }

    return new AgentLoop({
      agent,
      model: modelClient,
      toolBroker: this.toolBroker,
      processors,
      events: this.events,
      spanTracker: this.spanTracker,
      hooks: this.hooks,
      workingMemory: memoryStore?.working,
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

  private createSkillToolSource(): ToolSource {
    return createSkillToolSource(this.skillManager);
  }
}
