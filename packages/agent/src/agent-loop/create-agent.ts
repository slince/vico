// @vico/agent — 独立 Agent 构建函数，不依赖 Vico 容器
import type {LanguageModelV3} from '@ai-sdk/provider';
import {Agent} from './agent.js';
import type {ModelRef, TurnEvent} from './types.js';
import type {ApprovalResolver, Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {WorkingMemory} from '../memory/types.js';
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
import type {CheckpointStore} from "./checkpoint.js";
import {InMemoryCheckpointStore} from "./checkpoint-store.js";


/** LanguageModel 工厂类型 */
export type LanguageModelFactory = (ref: ModelRef) => LanguageModelV3;

type ToolOption = Tool[] | { tools: Tool[]; config?: Record<string, boolean> }

/** 组装工具列表：内置工具 + 额外工具 + working memory 工具 + skill 工具，支持按名称关闭 */
function buildTools(
  toolsOption: ToolOption | undefined,
  workingMemory: WorkingMemory | undefined,
  skills: Skill[] | undefined,
): Tool[] {
  const extraTools = Array.isArray(toolsOption) ? toolsOption : (toolsOption?.tools ?? []);
  const toolConfig = Array.isArray(toolsOption) ? undefined : toolsOption?.config;
  const allTools: Tool[] = [...basicTools, ...filesystemTools, ...codingTools, ...extraTools];
  if (workingMemory) {
    allTools.push(createUpdateWorkingMemoryTool(workingMemory));
  }
  if (skills) {
    allTools.push(...createSkillTools(skills));
  }
  // 对象模式下支持按名称关闭工具（config 中标记为 false 的被移除）
  return toolConfig ? allTools.filter(t => toolConfig[t.name]) : allTools;
}

/** 创建 Agent 的输入配置 */
export interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model: ModelRef | LanguageModelV3;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  /** 额外工具（数组模式）或 { tools, config } 对象模式（可手动关闭工具） */
  tools?: ToolOption;
  skills?: Skill[];
  memory?: MemoryStore;
  thread?: ThreadStore;
  /** 工作空间路径，作为工具执行的默认工作目录 */
  workspace?: string;
  tracer?: TurnTracer;
  events?: EventRecorder<TurnEvent>;
  /** 审批决策器，未提供则按 ToolPolicy 默认决策 */
  approvalResolver?: ApprovalResolver;
  checkpointStore?: CheckpointStore;
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

  const tools = buildTools(config.tools, memory.working, config.skills);

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
    checkpointStore: config.checkpointStore || new InMemoryCheckpointStore()
  });
}
