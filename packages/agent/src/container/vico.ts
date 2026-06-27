// @vico/agent - Vico: one-shot wiring for all Agent services
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import type {LanguageModelV3} from '@ai-sdk/provider';
import type {AgentConfig, ModelRef, TurnEvent} from '../agent-loop/types.js';
import {Agent} from '../agent-loop/agent.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import {createLanguageModel} from '../model/factory.js';
import type {ToolSource} from '../tool/types.js';
import {ToolBroker} from '../tool/tool-broker.js';
import {SkillManager} from '../skill/skill-manager.js';
import {FSSkillLoader} from '../skill/fs-skill-loader.js';
import {AgentLoop} from '../agent-loop/agent-loop.js';
import type {ApprovalGate} from '../agent-loop/approval-gate.js';
import type {ContextProcessor} from '../prompt/context-processor.js';
import {SystemPromptProcessor} from '../prompt/system-prompt-processor.js';
import {SkillProcessor} from '../skill/skill-processor.js';
import type {SkillStore} from '../skill/types.js';
import {MemoryProcessor} from '../memory/memory-processor.js';
import {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import {InMemoryThreadStore} from '../thread/memory-thread-store.js';
import {MittEventRecorder} from '../events/event-recorder.js';
import {LoopTracer, type TraceLevel} from '../observable/loop-tracer.js';
import {createAdaptersFromLevel, type TraceAdapter} from '../observable/trace-adapters.js';
import {createMemoryToolSource} from "../memory/working/memory-tool-source.js";
import {createBuiltInToolSource} from "../tool/builtin-tools-source.js";
import {createSkillToolSource} from "../skill/skill-tool-source.js";

/** LanguageModel 工厂类型 */
export type LanguageModelFactory = (ref: ModelRef) => LanguageModelV3;


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
  /** AgentLoop 追踪：TraceLevel 快捷配置 或 自定义适配器（默认读取 VICO_TRACE 环境变量，不传等同 0） */
  trace?: TraceLevel | { adapters: TraceAdapter[] };
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

  private readonly skillManager: SkillManager;
  private initialized = false;
  private options: VicoOptions;
  private readonly languageModelFactory: LanguageModelFactory;
  readonly runtime: AgentRuntime;
  readonly memory?: MemoryStore;
  readonly thread: ThreadStore;
  private readonly approvalGate?: ApprovalGate;

  constructor(options: VicoOptions = {}) {
    this.options = options;
    const trace = options.trace ?? (parseInt(process.env.VICO_TRACE ?? '0', 10) as TraceLevel);
    const adapters = typeof trace === 'object' ? trace.adapters : createAdaptersFromLevel(trace);
    this.tracer = new LoopTracer(this.events, adapters);
    this.languageModelFactory = options.languageModelFactory ?? createLanguageModel;
    this.runtime = new AgentRuntime(this.options.maxCached);
    this.memory = options.memory;
    this.approvalGate = options.approvalGate;
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
    const model = this.languageModelFactory(config.model);
    const agent = await this.buildAgent(config, model);
    this.runtime.register(agent);
    return agent;
  }

  /**
   * 创建单个 Agent（无缓存），绑定 skills / tools。
   */
  private async buildAgent(config: AgentConfig, model: LanguageModelV3): Promise<Agent> {
    if (!this.initialized) {
      throw new Error('Vico not initialized. Call await vico.init() first.');
    }

    // 加载 agent 绑定的 tools 和 skills
    const tools = config.tools ? await config.tools.load() : []

    const skills = config.skills ? await config.skills.load() : []

    const memory = config.memory ?? this.memory;
    const thread = config.thread ?? this.thread;

    return new Agent({
      config,
      model,
      skills,
      tools,
      memory,
      thread,
      tracer: this.tracer,
      approvalGate: this.approvalGate,
      events: this.events,
      loopFactory: this.buildLoop
    });
  }

  /** 为 Agent 构建 AgentLoop */
  public buildLoop(agent: Agent): AgentLoop {
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
    });
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  /** 获取 Agent，若不存在则通过 factory 创建并注册 */
  async getOrCreateAgent(agentId: string, factory: () => Promise<AgentConfig>): Promise<Agent> {
    const existing = this.runtime.getAgent(agentId);
    if (existing) return existing;
    return this.createAgent(await factory());
  }
}
