// @vico/agent — 独立 Agent 构建函数，不依赖 Vico 容器
import type {LanguageModelV3} from '@ai-sdk/provider';
import {Agent} from './agent.js';
import type {ModelRef, TurnEvent} from './types.js';
import type {ApprovalResolver, Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import {createSkillTools} from "../skill/tool/index.js";
import {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/thread-store.js';
import {TurnTracer} from "../observable/turn-tracer.js";
import type {EventRecorder} from "../events/types.js";
import {createLanguageModel} from "../model/factory.js";
import {InMemoryThreadStore} from "../thread/memory-thread-store.js";
import {MittEventRecorder} from "../events/event-recorder.js";
import {basicTools, codingTools, filesystemTools} from "../tool/builtin/index.js";
import {createUpdateWorkingMemoryTool} from "../memory/tool/working-memory-tool.js";
import {ConversationHistoryMemory} from "../memory/conversation-history-memory.js";
import {resolvePolicy} from "../tool/utils.js";


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
  /** 工作空间路径，作为工具执行的默认工作目录 */
  workspace?: string;
  /** 覆盖默认的文件工具列表（用于按 agent 配置过滤启用的工具） */
  fileTools?: Tool[];
  tracer?: TurnTracer;
  events?: EventRecorder<TurnEvent>;
  /** 审批决策器，未提供则按 ToolPolicy 默认决策 */
  approvalResolver?: ApprovalResolver;
}

/**
 * 独立创建 Agent 实例。
 */
export function createAgent(config: AgentConfig): Agent {
  const model = 'provider' in config.model
    ? createLanguageModel(config.model as ModelRef)
    : config.model

  const events = config.events || new MittEventRecorder<TurnEvent>()
  const thread = config.thread || new InMemoryThreadStore()
  const memory = config.memory || new MemoryStore({
    conversation: new ConversationHistoryMemory(thread, 10)
  });

  // 默认工具：基础 + workspace 工具始终注册，由 WorkspaceToolProcessor 根据 session.workspace 动态过滤
  const tools: Tool[] = [
    ...basicTools,
    ...(config.fileTools ?? [...filesystemTools, ...codingTools]),
    ...(config.tools || []),
  ];
  if (config.skills) {
    tools.push(...createSkillTools(config.skills));
  }
  if (memory.working) {
    tools.push(createUpdateWorkingMemoryTool(memory.working));
  }

  return new Agent({
    id: config.id,
    name: config.name,
    systemPrompt: config.systemPrompt,
    model: model,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 4096,
    maxSteps: config.maxSteps ?? 10,
    skills: config.skills || [],
    tools: tools,
    memory: memory,
    thread: config.thread || new InMemoryThreadStore(),
    workspace: config.workspace,
    tracer: config.tracer || new TurnTracer(events, []),
    events: events,
    approvalResolver: config.approvalResolver || resolvePolicy,
  });
}
