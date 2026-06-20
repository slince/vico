// @vico/agent - Vico: one-shot wiring for all Agent services
import type { AgentConfig } from '../contracts/agent.js';
import { Agent, type AgentFactory } from '../agent-runtime/types.js';
import { AgentRuntime } from '../agent-runtime/agent-runtime.js';
import type { ModelClient, ModelMessage } from '../model/model-client.js';
import type { ToolSource } from '../tool/types.js';
import { LocalToolHost } from '../tool/local-tool-host.js';
import { SkillManager } from '../skill/skill-manager.js';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';
import { createSkillTools, createSkillToolHandlers } from '../skill/skill-tools.js';
import { AgentLoop } from '../agent-loop/agent-loop.js';
import type { TurnResult } from '../agent-loop/types.js';
import { PromptAssembler } from '../prompt/assembler.js';
import { MittEventRecorder } from '../observable/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { CompositeHookRunner, type HookRunner } from '../hook/hook-runner.js';

/** ModelClient 工厂 — 用于 getRuntime() / invoke() 批量创建 Agent */
export type ModelClientFactory = (config: AgentConfig) => ModelClient;

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
 * const agent = await vico.createAgent(config, modelClient);
 * await agent.loop.runTurn(threadId, history, message, signal);
 *
 * // 或使用 invoke 一行对话
 * vico.setModelFactory((c) => new AISDKModelClient(...));
 * const result = await vico.invoke({ agentId: 'bot', message: 'Hello' });
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
  private modelFactory?: ModelClientFactory;
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

    // 触发工具注册
    const allTools = await this.toolHost.listTools({
      userId: '',
      agentId: config.id,
      threadId: '',
      workspace: '',
      hooks: [],
      awaitApproval: async () => ({ approved: true }),
      signal: new AbortController().signal,
    });

    // 按 agent config 过滤工具和 skill
    const allowedTools = config.allowedToolNames
      ? allTools.filter((t) => config.allowedToolNames!.includes(t.name))
      : allTools;

    const boundSkills = config.skillIds
      ? config.skillIds.map((id) => this.skillManager.get(id)).filter(Boolean)
      : this.skillManager.listAll();

    const skillCatalog = boundSkills.map((s) => ({
      name: s!.name,
      description: s!.description,
      location: s!.path,
    }));

    const loop = new AgentLoop({
      config,
      model: modelClient,
      toolHost: this.toolHost,
      promptAssembler: new PromptAssembler(),
      events: this.events,
      spanTracker: this.spanTracker,
      hooks: this.hooks,
      skillCatalog,
      boundTools: allowedTools,
    });

    return new Agent({
      config,
      loop,
      skills: boundSkills.filter(Boolean) as Agent['skills'],
      tools: allowedTools,
    });
  }

  /**
   * 返回带 LRU 缓存的 AgentRuntime。
   */
  getRuntime(factory: ModelClientFactory): AgentRuntime {
    const agentFactory: AgentFactory = async (config) => {
      const mc = factory(config);
      return this.createAgent(config, mc);
    };
    return new AgentRuntime(agentFactory, this.options.maxCached);
  }

  /**
   * 设置 ModelClient 工厂（invoke 需要）。
   */
  setModelFactory(factory: ModelClientFactory): void {
    this.modelFactory = factory;
  }

  /**
   * 一行对话：发送消息给指定 Agent，返回结果。
   *
   * 首次调用时为该 agentId 创建 Agent 并缓存，后续调用复用。
   *
   * @example
   * ```ts
   * vico.setModelFactory((c) => new FakeModelClient());
   * const result = await vico.invoke({ agentId: 'bot', message: 'Hello!' });
   * console.log(result.messages.map(m => m.content).join('\\n'));
   * ```
   */
  async invoke(params: {
    agentId: string;
    message: string;
    config?: AgentConfig;
    modelClient?: ModelClient;
  }): Promise<TurnResult> {
    if (!this.modelFactory && !params.modelClient) {
      throw new Error('setModelFactory() or pass modelClient before calling invoke()');
    }

    const config =
      params.config ??
      ({
        id: params.agentId,
        name: params.agentId,
        systemPrompt: 'You are a helpful assistant.',
        model: { provider: 'openai', model: 'gpt-4o' },
        temperature: 0.7,
        maxTokens: 4096,
        maxSteps: 5,
      } as AgentConfig);

    const mc = params.modelClient ?? this.modelFactory!(config);
    const agent = await this.createAgent(config, mc);

    const userMessage: ModelMessage = { role: 'user', content: params.message };

    return agent.loop.runTurn(
      `invoke-${params.agentId}-${Date.now()}`,
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
