// @vico/agent - Vico: one-shot wiring for all Agent services
import type { AgentConfig, ModelRef } from '../contracts/agent.js';
import type {TurnResult} from '../agent-loop/types.js';
import {Agent, type AgentFactory} from '../agent-loop/types.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import type {ModelClient, ModelMessage} from '../model/model-client.js';
import type {ToolSource} from '../tool/types.js';
import {LocalToolHost} from '../tool/local-tool-host.js';
import {SkillManager} from '../skill/skill-manager.js';
import {FSSkillLoader} from '../skill/fs-skill-loader.js';
import {createSkillToolHandlers, createSkillTools} from '../skill/skill-tools.js';
import {AgentLoop} from '../agent-loop/agent-loop.js';
import {SkillCatalogProcessor, SystemPromptProcessor} from '../prompt/default-processors.js';
import {MittEventRecorder} from '../observable/event-recorder.js';
import {InMemorySpanTracker} from '../observable/span-tracker.js';
import {CompositeHookRunner, type HookRunner} from '../hook/hook-runner.js';

/** ModelClient 工厂 — 用于 getRuntime() 批量创建 Agent */
export type ModelClientFactory = (ref: ModelRef) => ModelClient;

/** Vico 配置选项 */
export interface VicoOptions {
  /** Skill 扫描根目录 */
  skillRoots?: string[];
  /** 额外的工具来源 */
  toolSources?: ToolSource[];
  /** 全局生命周期钩子 */
  hooks?: HookRunner[];
  /** AgentRuntime LRU 缓存上限（默认 50） */
  maxCached?: number;
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
 * const runtime = vico.getRuntime((c) => new AISDKModelClient(...));
 * await runtime.createAgent(config);
 *
 * // 一行对话
 * const result = await vico.invoke({ agentId: config.id, message: 'Hello' });
 * ```
 */
export class Vico {
  readonly events = new MittEventRecorder();
  readonly spanTracker = new InMemorySpanTracker();
  readonly toolHost = new LocalToolHost();
  readonly hooks = new CompositeHookRunner();

  private skillManager: SkillManager;
  private initialized = false;
  private options: VicoOptions;
  private runtime?: AgentRuntime;

  constructor(options: VicoOptions = {}) {
    this.options = options;
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

    const loop = new AgentLoop({
      config,
      model: modelClient,
      toolHost: this.toolHost,
      processors: [
        new SystemPromptProcessor(),
        new SkillCatalogProcessor(skillCatalog),
      ],
      events: this.events,
      spanTracker: this.spanTracker,
      hooks: this.hooks,
      boundTools,
    });

    return new Agent({
      config,
      loop,
      skills: boundSkills,
      tools: boundTools,
    });
  }

  /**
   * 创建并缓存 AgentRuntime。
   */
  getRuntime(factory: ModelClientFactory): AgentRuntime {
    const agentFactory: AgentFactory = async (config) => {
      const mc = factory(config.model);
      return this.createAgent(config, mc);
    };
    this.runtime = new AgentRuntime(agentFactory, this.options.maxCached);
    return this.runtime;
  }

  /**
   * 一行对话：从 Runtime 中查找 Agent，发送消息并返回结果。
   *
   * @example
   * ```ts
   * const runtime = vico.getRuntime((c) => new MyModelClient(c));
   * await runtime.createAgent(config);
   * const result = await vico.invoke(config.id, 'Hello!');
   * ```
   */
  async invoke(agentId: string, message: string, options?: { threadId?: string; [key: string]: unknown }): Promise<TurnResult> {
    if (!this.runtime) {
      throw new Error('Runtime not initialized. Call getRuntime(factory) first.');
    }

    const agent = this.runtime.getAgent(agentId);
    if (!agent) {
      throw new Error(
        `Agent "${agentId}" not found in runtime. Create it first via runtime.createAgent().`,
      );
    }

    const userMessage: ModelMessage = { role: 'user', content: message };
    const threadId = options?.threadId ?? `invoke-${agentId}-${Date.now()}`;

    return agent.loop.runTurn(
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
