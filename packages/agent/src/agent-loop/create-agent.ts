// @vico/agent — 独立 Agent 构建函数，不依赖 Vico 容器
import {Agent} from './agent.js';
import type {AgentConfig, ModelRef, TurnEvent} from './types.js';
import {createLanguageModel} from "../model/factory.js";
import {InMemoryThreadStore} from "../thread/memory-thread-store.js";
import {TurnTracer} from "../observable/turn-tracer.js";
import {MittEventRecorder} from "../events/event-recorder.js";
import {MemoryStore} from "../memory/memory-store.js";


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
