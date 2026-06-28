// @vico/agent — 独立 Agent 构建函数，不依赖 Vico 容器
import type {LanguageModelV3} from '@ai-sdk/provider';
import {Agent} from './agent.js';
import type {ModelRef, TurnEvent} from './types.js';
import type {Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import {TurnTracer} from "../observable/turn-tracer.js";
import type {EventRecorder} from "../events/types.js";
import type {ApprovalGate} from "./approval-gate.js";
import {createLanguageModel} from "../model/factory.js";
import {InMemoryThreadStore} from "../thread/memory-thread-store.js";
import {MittEventRecorder} from "../events/event-recorder.js";


/** LanguageModel 工厂类型 */
export type LanguageModelFactory = (ref: ModelRef) => LanguageModelV3;

/** 创建 Agent 的输入配置 */
export interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model: ModelRef | LanguageModelV3;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  tools?: Tool[];
  skills?: Skill[];
  memory?: MemoryStore;
  thread?: ThreadStore;
  tracer?: TurnTracer;
  events?: EventRecorder<TurnEvent>;
  approvalGate?: ApprovalGate;
}

/**
 * 独立创建 Agent 实例。
 */
export function createAgent(config: AgentConfig): Agent {
  const model = 'provider' in config.model
    ? createLanguageModel(config.model as ModelRef)
    : config.model

  const events = config.events || new MittEventRecorder<TurnEvent>()

  return new Agent({
    id: config.id,
    name: config.name,
    systemPrompt: config.systemPrompt,
    model: model,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 4096,
    maxSteps: config.maxSteps ?? 10,
    skills: config.skills || [],
    tools: config.tools || [],
    memory: config.memory || new MemoryStore(),
    thread: config.thread || new InMemoryThreadStore(),
    tracer: config.tracer || new TurnTracer(events, []),
    events: events,
    approvalGate: config.approvalGate,
  });
}
