// @vico/agent - Vico: one-shot wiring for all Agent services
import type {AgentConfig} from '../agent-loop/types.js';
import type {TurnResult} from '../agent-loop/types.js';
import {Agent, type AgentFactory} from '../agent-loop/types.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import type {ModelClient, ModelClientFactory, ModelMessage} from '../model/types.js';
import {defaultModelFactory} from '../model/factory.js';
import type {ToolSource} from '../tool/types.js';
import {LocalToolHost} from '../tool/local-tool-host.js';
import {SkillManager} from '../skill/skill-manager.js';
import {FSSkillLoader} from '../skill/fs-skill-loader.js';
import {createSkillToolHandlers, createSkillTools} from '../skill/skill-tools.js';
import {AgentLoop} from '../agent-loop/agent-loop.js';
import type {ContextProcessor} from '../prompt/context-processor.js';
import {SystemPromptProcessor} from '../prompt/system-prompt-processor.js';
import {SkillCatalogProcessor} from '../skill/skill-catalog-processor.js';
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

/**
 * Vico — 一键装配所有 Agent 服务。
 *
 * @example
 * ```ts
 * const vico = new Vico({ skillRoots: ['./skills'] });
 * await vico.init();
 *
 * // 创建 Agent 并注册到 Runtime（使用默认 modelFactory）
 * await vico.runtime.createAgent(config);
 *
 * // 一行对话
 * const result = await vico.invoke(config.id, 'Hello');
 * ```
 */
export class Vico {
  readonly events = new MittEventRecorder();
  readonly spanTracker = new InMemorySpanTracker();
  readonly toolHost = new LocalToolHost();
  readonly hooks = new CompositeHookRunner();

  private readonly skillManager: SkillManager;
  private initialized = false;
  private options: VicoOptions;
  private readonly modelFactory: ModelClientFactory;
  readonly runtime: AgentRuntime;

  constructor(options: VicoOptions = {}) {
    this.options = options;
    this.modelFactory = options.modelFactory ?? defaultModelFactory;
    this.runtime = this.createRuntime(this.modelFactory);
    this.skillManager = new SkillManager(new FSSkillLoader());

    if (options.toolSources) {
      for (const source of options.toolSources) {
        this.toolHost.addSource(source);
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

    this.toolHost.addSource(this.createSkillToolSource());
    this.initialized = true;
  }

  /**
   * 创建单个 Agent（无缓存），绑定 skills / tools。
   */
  async createAgent(config: AgentConfig, modelClient: ModelClient): Promise<Agent> {
    if (!this.initialized) {
      throw new Error('Vico not initialized. Call await vico.init() first.');
    }

    // 加载 agent 绑定的 tools 和 skills
    const boundTools = config.tools ? await config.tools.load() : await this.toolHost.listTools({
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

    const skillCatalog = boundSkills.map((s) => ({
      name: s.name,
      description: s.description,
      location: s.path,
    }));

    const agent: Agent = new Agent({
      config,
      loopFactory: (): AgentLoop => {
        const processors: ContextProcessor[] = [
          new SystemPromptProcessor(),
          new SkillCatalogProcessor(skillCatalog),
        ];
        if (this.options.memoryStore) {
          processors.push(new MemoryProcessor(this.options.memoryStore));
        }

        return new AgentLoop({
          agent,
          model: modelClient,
          toolHost: this.toolHost,
          processors,
          events: this.events,
          spanTracker: this.spanTracker,
          hooks: this.hooks,
          workingMemory: this.options.memoryStore?.working,
        });
      },
      skills: boundSkills,
      tools: boundTools,
    });

    return agent;
  }

  /** 创建 AgentRuntime */
  private createRuntime(factory: ModelClientFactory): AgentRuntime {
    const agentFactory: AgentFactory = async (config) => {
      const mc = factory(config.model);
      return this.createAgent(config, mc);
    };
    return new AgentRuntime(agentFactory, this.options.maxCached);
  }

  /**
   * 一行对话：从 Runtime 中查找 Agent，发送消息并返回结果。
   *
   * @example
   * ```ts
   * await vico.runtime.createAgent(config);
   * const result = await vico.invoke(config.id, 'Hello!');
   * ```
   */
  async invoke(agentId: string, message: string, options?: { threadId?: string; [key: string]: unknown }): Promise<TurnResult> {
    const agent = this.runtime.getAgent(agentId);
    if (!agent) {
      throw new Error(
        `Agent "${agentId}" not found in runtime. Create it first via runtime.createAgent().`,
      );
    }

    const userMessage: ModelMessage = { role: 'user', content: message };
    const threadId = options?.threadId ?? `invoke-${agentId}-${Date.now()}`;

    return agent.getLoop().runTurn(
      threadId,
      [],
      userMessage,
      new AbortController().signal,
    );
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  private createSkillToolSource(): ToolSource {
    const manager = this.skillManager;
    const handlers = createSkillToolHandlers(manager);
    return {
      name: 'skill',
      list: async () => createSkillTools(manager),
      getHandler: (name: string) => {
        const h = (handlers as Record<string, { execute: (call: unknown) => unknown }>)[name];
        return h ? { execute: async (call, _ctx) => h.execute(call) } : undefined;
      },
    };
  }
}
