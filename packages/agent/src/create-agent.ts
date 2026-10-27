// @vico/agent — 独立 Agent 构建函数，不依赖 Vico 容器
import type {Agent} from './agent.js';
import {LoopAgent} from './loop-agent.js';
import {isLanguageModel, type LanguageModel, type ModelConfig, type ModelRef, type ReasoningEffort} from '@vico/model';
import type {TurnEvent} from './types.js';
import type {ApprovalResolver, Tool} from '@vico/tool';
import type {Skill} from '@vico/skill';
import {MemoryStore} from '@vico/memory';
import type {ThreadStore} from '@vico/thread';
import type {EventRecorder} from '@vico/events';
import {InMemoryThreadStore} from '@vico/thread';
import {MittEventRecorder} from '@vico/events';
import {ConversationHistoryMemory} from '@vico/memory';
import {DEFAULT_CONVERSATION_WINDOW} from '@vico/memory';
import {composeResolvers, defaultApprovalResolvers} from '@vico/tool';
import type {CheckpointStore} from '@vico/checkpoint';
import {MemoryCheckpointStore} from '@vico/checkpoint';
import {ModelContextCompactor} from '@vico/compaction';
import type {CompactionSettings} from '@vico/compaction';


/** LanguageModel 工厂类型 */
export type LanguageModelFactory = (config: ModelConfig) => LanguageModel;

/** 创建 Agent 的输入配置 */
export interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model: ModelRef;
  temperature?: number;
  maxSteps?: number;
  /** 推理力度，不传则 provider 默认 */
  reasoning?: ReasoningEffort;
  /** Agent 使用的完整工具集（已组装，含内置/文件系统/coding/语义记忆/skill 工具） */
  tools?: Tool[];
  /** Agent 绑定的 Skill 列表（已加载） */
  skills?: Skill[];
  memory?: MemoryStore;
  /** 会话历史滑动窗口大小（已完成轮次数），仅在未显式传入 memory 时生效 */
  conversationWindow?: number;
  thread?: ThreadStore;
  /** 工作空间路径，作为工具执行的默认工作目录 */
  workspace?: string;
  events?: EventRecorder<TurnEvent>;
  /** 自定义审批 resolver（support/resolve 两段式），插在 never 保护之后、workspace 之前 */
  approvalResolver?: ApprovalResolver;
  checkpointStore?: CheckpointStore;
  /** 上下文压缩配置；未传则不构造 compactor（自动压缩关闭，向后兼容） */
  compaction?: Partial<CompactionSettings>;
}

/**
 * 独立创建 Agent 实例。
 */
export async function createAgent(config: AgentConfig): Promise<Agent> {
  const events = config.events || new MittEventRecorder<TurnEvent>()
  const thread = config.thread || new InMemoryThreadStore()
  const memory = config.memory || new MemoryStore({
    conversation: new ConversationHistoryMemory(thread)
  });

  const skills = config.skills ?? [];
  const tools = config.tools ?? [];

  // 上下文压缩器：仅在显式配置 compaction 时构造；模型为 ModelConfig 时才能拿到 contextWindow/摘要模型
  const modelConfig = !isLanguageModel(config.model) ? config.model : undefined;
  // 输出上限来自模型级 maxOutputTokens（AgentConfig 不再暴露独立 maxTokens）
  const maxTokens = modelConfig?.maxOutputTokens;
  const compactor = config.compaction
    ? new ModelContextCompactor({
        thread,
        conversationWindow: config.conversationWindow ?? DEFAULT_CONVERSATION_WINDOW,
        modelConfig,
        maxTokens,
        settings: config.compaction,
      })
    : undefined;

  // 优先级由各 resolver 的 order() 决定，composeResolvers 内部按 order 升序调度；
  // 自定义 resolver 通过自身 order() 声明插入位置（默认档位见 ApprovalPriority）
  const approvalResolvers: ApprovalResolver[] = [...defaultApprovalResolvers]

  if (config.approvalResolver) {
    approvalResolvers.push(config.approvalResolver)
  }

  return new LoopAgent({
    id: config.id,
    name: config.name,
    systemPrompt: config.systemPrompt,
    model: config.model,
    temperature: config.temperature ?? 0.7,
    reasoning: config.reasoning,
    maxTokens,
    maxSteps: config.maxSteps ?? 10,
    skills,
    tools,
    memory: memory,
    thread: thread,
    workspace: config.workspace,
    events: events,
    approvalResolver: composeResolvers(...approvalResolvers),
    checkpointStore: config.checkpointStore || new MemoryCheckpointStore(),
    compactor,
  });
}
