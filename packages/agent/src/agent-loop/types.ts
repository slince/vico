// @vico/agent - AgentLoop module type definitions
import {z} from 'zod';
import type {ModelMessage} from '../model/types.js';
import type {ToolStore} from '../tool/types.js';
import type {SkillStore} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';

/** 模型引用 */
export const ModelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

/** Agent 配置（从 DB 加载） */
export const AgentConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  systemPrompt: z.string().default(''),
  model: ModelRefSchema,
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(4096),
  maxSteps: z.number().int().min(1).max(100).default(10),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema> & {
  /** 工具存储 — 加载该 Agent 绑定的工具 */
  tools?: ToolStore;
  /** Skill 存储 — 加载该 Agent 绑定的 Skill */
  skills?: SkillStore;
  /** Agent 自身 memory（优先于容器 memoryStore） */
  memory?: MemoryStore;
  /** Agent 自身 thread（优先于容器 threadStore） */
  thread?: ThreadStore;
};
export type ModelRef = z.infer<typeof ModelRefSchema>;

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  usage: { input: number; output: number };
  messages: ModelMessage[];
}

/** runTurn 选项 */
export interface RunTurnOptions {
  scopeId?: string;
  userId?: string;
  workspace?: string;
}

export type { ToolCallSession } from '../tool/types.js';

// ── 核心领域模型：Thread > Turn > Step ──

/**
 * Step — turn 内的一次 LLM 调用 + 可选工具执行。
 * 由 _run 在每轮迭代时创建，随 callModel / executeToolCalls / dispatchTools 流转。
 */
export interface Step {
  /** 当前步骤编号（0 起始） */
  index: number;
  /** 所属 thread */
  threadId: string;
  /** 执行作用域 */
  scopeId: string;
  /** 中断信号 */
  signal: AbortSignal;
}

/**
 * Turn — 用户发送一条消息到 agent 完成响应的完整对话轮次。
 * Thread（会话）包含多个 Turn，Turn 包含多个 Step。
 *
 * 与 thread/types.ts 中的 Turn（存储模型）对应：
 * 存储 Turn 记录运行时元数据，TurnResult 作为 runTurn 的最终返回值。
 */

/** turn 执行过程中的流式事件（仅用于 agent.on() 订阅） */
export type TurnEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'reasoning-delta'; content: string }
  | { type: 'tool-call-start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; name: string; status: 'success' | 'error'; output: unknown }
  | { type: 'step-start'; step: number }
  | { type: 'step-end'; step: number }
  | { type: 'compacted'; removedTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { input: number; output: number } };

