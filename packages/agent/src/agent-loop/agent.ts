import type {LanguageModelV3} from '@ai-sdk/provider';
import {ModelClient} from '../model/model-client.js';
import type {TurnEvent, TurnResult} from './types.js';
import type {Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import type {EventPayload, EventRecorder} from '../events/types.js';
import type {AgentLoop} from './agent-loop.js';
import {buildLoop, collectTurnResult} from "./utils.js";
import {TurnOutput} from "./turn-output.js";
import {ModelMessage} from "../model/types.js";
import type {ApprovalGate} from "./approval-gate.js";
import {LoopTracer} from "../observable/loop-tracer.js";
import {MittEventRecorder} from "../events/event-recorder.js";

export type LoopFactory = (agent: Agent) => AgentLoop

/** invoke 调用选项 */
export interface InvokeOptions {
  threadId?: string;
  userId?: string;
  workspace?: string;
  scopeId?: string;
}

/** Agent 构造参数 */
export interface AgentOptions {
  id: string;
  name: string;
  systemPrompt: string;
  model: LanguageModelV3;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  skills?: Skill[];
  tools?: Tool[];
  memory?: MemoryStore;
  thread: ThreadStore;
  approvalGate?: ApprovalGate;
  events?: EventRecorder<TurnEvent>;
  tracer?: LoopTracer;
  loopFactory?: LoopFactory;
}

/** Agent — 配置 + 运行时 loop + 绑定（memory/thread/skills/tools） */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly model: LanguageModelV3;
  readonly modelClient: ModelClient;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly maxSteps: number;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory?: MemoryStore;
  readonly thread: ThreadStore;
  readonly approvalGate?: ApprovalGate;
  readonly events: EventRecorder<TurnEvent>;
  readonly tracer?: LoopTracer;
  readonly loop: AgentLoop;

  constructor(params: AgentOptions) {
    this.id = params.id;
    this.name = params.name;
    this.systemPrompt = params.systemPrompt;
    this.model = params.model;
    this.modelClient = new ModelClient(params.model);
    this.temperature = params.temperature;
    this.maxTokens = params.maxTokens;
    this.maxSteps = params.maxSteps;
    this.skills = params.skills ?? [];
    this.tools = params.tools ?? [];
    this.memory = params.memory;
    this.thread = params.thread;
    this.approvalGate = params.approvalGate;
    this.events = params.events || new MittEventRecorder<TurnEvent>();
    this.tracer = params.tracer;

    const loopFactory = params.loopFactory || buildLoop;
    this.loop = loopFactory(this)
  }

  /** 订阅 turn 事件，委托给 AgentLoop */
  on<K extends string>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.on(event, handler);
  }

  /** 取消订阅 turn 事件 */
  off<K extends string>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.off(event, handler);
  }

  /**
   * 一行对话：从 Runtime 中查找 Agent，发送消息并返回结果。
   */
  async invoke(agentId: string, message: string, options?: InvokeOptions): Promise<TurnResult> {
    return collectTurnResult(this.run(agentId, message, options));
  }

  /** 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise */
  stream(agentId: string, message: string, options?: InvokeOptions): TurnOutput {
    return this.run(agentId, message, options);
  }

  /** 获取 Agent 并构造 runTurn 参数 */
  private run(agentId: string, message: string, options?: InvokeOptions) {
    const userMessage: ModelMessage = { role: 'user', content: message };
    const threadId = options?.threadId ?? `invoke-${agentId}-${Date.now()}`;
    return this.loop.runTurn(threadId, userMessage, {
      userId: options?.userId,
      workspace: options?.workspace,
      scopeId: options?.scopeId,
    });
  }

}
