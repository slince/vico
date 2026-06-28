// @vico/agent - Vico: one-shot wiring for all Agent services
import type {AgentConfig, LanguageModelFactory, TurnEvent} from '../agent-loop/types.js';
import type {Tool} from '../tool/types.js';
import type {Agent} from '../agent-loop/agent.js';
import {createAgent} from '../agent-loop/create-agent.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import {createLanguageModel} from '../model/factory.js';
import {SkillRegistry} from '../skill/skill-registry.js';
import {FSSkillLoader} from '../skill/fs-skill-loader.js';
import type {ApprovalGate} from '../agent-loop/approval-gate.js';
import {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import {InMemoryThreadStore} from '../thread/memory-thread-store.js';
import {MittEventRecorder} from '../events/event-recorder.js';
import {LoopTracer} from '../observable/loop-tracer.js';
import {createAdaptersFromLevel} from '../observable/trace-adapter';
import {collectSkillDirs} from './utils.js';
import {SkillOptions, TraceOptions} from "./options.js";

/** Vico 配置选项 */
export interface VicoOptions {
  /** Skill 配置 */
  skills?: SkillOptions;
  /** 额外的工具 */
  tools?: Tool[];
  /** LanguageModel 工厂（不传则使用内置 createLanguageModel） */
  languageModelFactory?: LanguageModelFactory;
  /** AgentRuntime LRU 缓存上限（默认 50） */
  maxCached?: number;
  /** 全局 MemoryStore（agent 自身未配置时使用） */
  memory?: MemoryStore;
  /** 全局 ThreadStore（agent 自身未配置时使用） */
  thread?: ThreadStore;
  /** 工具审批门控（不传则不启用审批） */
  approvalGate?: ApprovalGate;
  /** AgentLoop 追踪：TraceLevel 快捷配置 或 自定义适配器（不传等同 0） */
  trace?: TraceOptions
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
  readonly events = new MittEventRecorder<TurnEvent>();
  readonly tracer: LoopTracer;

  private readonly skillRegistry: SkillRegistry;
  private initialized = false;
  private options: VicoOptions;
  private readonly languageModelFactory: LanguageModelFactory;
  readonly runtime: AgentRuntime;
  readonly memory?: MemoryStore;
  readonly thread: ThreadStore;
  private readonly approvalGate?: ApprovalGate;

  constructor(options: VicoOptions = {}) {
    this.options = options;
    this.tracer = this.createTracer(options.trace);
    this.languageModelFactory = options.languageModelFactory ?? createLanguageModel;
    this.runtime = new AgentRuntime(this.options.maxCached);
    this.memory = options.memory;
    this.approvalGate = options.approvalGate;
    this.thread = options.thread ?? new InMemoryThreadStore();
    this.skillRegistry = this.createSkillRegistry();
  }

  /** 根据 TraceOptions 构建 LoopTracer */
  private createTracer(trace?: TraceOptions): LoopTracer {
    const resolved = trace ?? 0;
    const adapters = typeof resolved === 'object'
      ? [...createAdaptersFromLevel(resolved.level ?? 0), ...(resolved.adapters ?? [])]
      : createAdaptersFromLevel(resolved);
    return new LoopTracer(this.events, adapters);
  }

  /** 根据配置构建 SkillRegistry，有 skillDirs 时默认追加 FSSkillLoader，支持内联 Skill 数组 */
  private createSkillRegistry(): SkillRegistry {
    const skills = this.options.skills;

    // Skill[] 数组形式
    if (Array.isArray(skills)) {
      const registry = new SkillRegistry([new FSSkillLoader()]);
      registry.registerAll(skills);
      return registry;
    }

    // SkillSettings 对象形式
    if (skills) {
      const hasSkillDirs = skills.skillDirs && skills.skillDirs.length > 0;
      const loaders = skills.loaders ? [...skills.loaders] : [];

      if (hasSkillDirs) {
        loaders.push(new FSSkillLoader());
      }
      if (loaders.length === 0) {
        loaders.push(new FSSkillLoader());
      }

      const registry = new SkillRegistry(loaders);
      if (skills.skills) {
        registry.registerAll(skills.skills);
      }
      return registry;
    }

    // 无任何 skills 配置
    return new SkillRegistry([new FSSkillLoader()]);
  }

  /**
   * 初始化：发现 Skill、扫描 Skill 目录。
   * @returns Promise that resolves when initialization is complete
   */
  async init(): Promise<void> {
    if (this.options.skills && 'skillDirs' in this.options.skills) {
      const dirs = collectSkillDirs(this.options.skills);
      if (dirs.length > 0) {
        await this.skillRegistry.discover(dirs);
      }
    }
    this.initialized = true;
  }

  /**
   * 获取 Agent，若不存在则通过 factory 创建并注册。
   * @param agentId - Agent 唯一标识
   * @param factory - 创建 Agent 配置的工厂函数（仅在 Agent 不存在时调用）
   * @returns 已存在的或新创建的 Agent 实例
   */
  async createIfAbsent(agentId: string, factory: () => Promise<AgentConfig>): Promise<Agent> {
    const existing = this.runtime.getAgent(agentId);
    if (existing) return existing;
    return this.createAgent(await factory());
  }

  /**
   * 构建 Agent 并注册到 Runtime。
   * @param config - Agent 创建配置
   * @returns 已注册的 Agent 实例
   */
  async createAgent(config: AgentConfig): Promise<Agent> {
    const agent = await this.buildAgent(config);
    this.runtime.register(agent);
    return agent;
  }

  /**
   * 创建单个 Agent（无缓存），委托到独立 buildAgent。
   */
  private async buildAgent(config: AgentConfig): Promise<Agent> {
    if (!this.initialized) {
      throw new Error('Vico not initialized. Call await vico.init() first.');
    }

    return createAgent({
      ...config,
      tools: config.tools ?? this.options.tools,
      skills: config.skills ?? this.skillRegistry.listAll(),
      memory: config.memory ?? this.memory,
      thread: config.thread ?? this.thread,
      tracer: config.tracer ?? this.tracer,
      events: config.events ?? this.events,
      approvalGate: config.approvalGate ?? this.approvalGate,
    });
  }
}
