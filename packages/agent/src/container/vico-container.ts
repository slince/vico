// @vico/agent - VicoContainer: one-shot wiring for all Agent services
import type { AgentConfig } from '../contracts/agent.js';
import type { Agent, AgentFactory } from '../agent-runtime/types.js';
import { AgentRuntime } from '../agent-runtime/agent-runtime.js';
import type { ModelClient } from '../model/model-client.js';
import type { ToolSource } from '../tool/types.js';
import { LocalToolHost } from '../tool/local-tool-host.js';
import { SkillManager } from '../skill/skill-manager.js';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';
import { createSkillTools, createSkillToolHandlers } from '../skill/skill-tools.js';
import { AgentLoop } from '../agent-loop/agent-loop.js';
import { PromptAssembler } from '../prompt/assembler.js';
import { MittEventRecorder } from '../observable/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { CompositeHookRunner, type HookRunner } from '../hook/hook-runner.js';

/** ModelClient 工厂 — 用于 getRuntime() 批量创建 Agent */
export type ModelClientFactory = (config: AgentConfig) => ModelClient;

/** VicoContainer 配置选项 */
export interface VicoContainerOptions {
  /** Skill 扫描根目录 */
  skillRoots?: string[];
  /** 额外的工具来源（在 builtin + skill 之外） */
  toolSources?: ToolSource[];
  /** 全局生命周期钩子 */
  hooks?: HookRunner[];
  /** AgentRuntime LRU 缓存上限（默认 50） */
  maxCached?: number;
}

/**
 * VicoContainer — 一键装配所有 Agent 服务。
 *
 * 共享服务（events、spanTracker、toolHost、skillManager、hooks）创建一次，
 * createAgent() 按需创建单个 Agent，getRuntime() 返回带 LRU 缓存的 AgentRuntime。
 *
 * @example
 * ```ts
 * const vico = new VicoContainer({ skillRoots: ['./skills'] });
 * await vico.init();
 * const agent = await vico.createAgent(config, modelClient);
 * await agent.loop.runTurn(threadId, history, message, signal);
 * ```
 */
export class VicoContainer {
  readonly events = new MittEventRecorder();
  readonly spanTracker = new InMemorySpanTracker();
  readonly toolHost = new LocalToolHost();
  readonly hooks = new CompositeHookRunner();

  private skillManager: SkillManager;
  private initialized = false;
  private options: VicoContainerOptions;

  constructor(options: VicoContainerOptions = {}) {
    this.options = options;
    this.skillManager = new SkillManager(new FSSkillLoader());

    // 注册额外的工具来源
    if (options.toolSources) {
      for (const source of options.toolSources) {
        this.toolHost.addSource(source);
      }
    }

    // 注册全局钩子
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

    // 注册 skill 工具源（skill / skill_search / skill_read）
    this.toolHost.addSource(this.createSkillToolSource());

    this.initialized = true;
  }

  /**
   * 创建单个 Agent（无缓存）。
   *
   * @param config - Agent 配置
   * @param modelClient - 已创建的 ModelClient 实例
   */
  async createAgent(config: AgentConfig, modelClient: ModelClient): Promise<Agent> {
    if (!this.initialized) {
      throw new Error('VicoContainer not initialized. Call await vico.init() first.');
    }

    // 触发工具注册（遍历所有 source，将工具写入 registry + handlers）
    await this.toolHost.listTools({
      tenantId: config.tenantId,
      userId: '',
      agentId: config.id,
      threadId: '',
      workspace: '',
      hooks: [],
      awaitApproval: async () => ({ approved: true }),
      signal: new AbortController().signal,
    });

    const loop = new AgentLoop({
      config,
      model: modelClient,
      toolHost: this.toolHost,
      promptAssembler: new PromptAssembler(),
      events: this.events,
      spanTracker: this.spanTracker,
      hooks: this.hooks,
    });

    return { config, loop };
  }

  /**
   * 返回带 LRU 缓存的 AgentRuntime。
   *
   * @param factory - 根据 AgentConfig 创建 ModelClient 的工厂函数
   */
  getRuntime(factory: ModelClientFactory): AgentRuntime {
    const agentFactory: AgentFactory = async (config) => {
      const mc = factory(config);
      return this.createAgent(config, mc);
    };
    return new AgentRuntime(agentFactory, this.options.maxCached);
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  /** 构建 skill 工具的 ToolSource */
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
