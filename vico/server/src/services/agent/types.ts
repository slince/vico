import { z } from 'zod';
import type { ModelConfigRow } from '../model/types.js';

// ── DB 行类型 ──

/** 单个内置工具的配置：简单工具为 boolean，exec 支持 need_approval */
export type BuiltinToolEntry = boolean | { enabled: boolean; need_approval?: boolean };

/** Agent 内置工具配置 */
export type BuiltinToolsConfig = Record<string, BuiltinToolEntry>;

/** agents 表行类型，与 Drizzle schema 对齐 */
export interface AgentRow {
  id: string;
  name: string;
  system_prompt: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
  rag_mode: string;
  max_steps: number;
  enabled: number;
  builtin_tools: string;  // JSON string of BuiltinToolsConfig
  kb_id: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

/** Agent 详情/列表类型 */
export interface AgentDetail extends AgentRow {}

// ── 运行时配置 ──

/**
 * Agent 运行时配置。
 *
 * 一次性解析 Agent 运行所需的所有参数（模型、指令、选项），
 * 供 agentProxy 通过 requestContext 直接同步读取，避免在执行路径中
 * 反复查询 DB。
 */
export interface AgentRuntimeConfig {
  /** Agent 详情 */
  agent: AgentDetail;
  /** 模型配置 */
  model: ModelConfigRow;
  /** 编译后的基础系统指令（system_prompt + Skill 提示词），不含任务级动态内容 */
  instructions: string;
  /** 工作空间路径（来自全局配置） */
  workspace?: string;
  /** 解析后的内置工具配置（来自 DB builtin_tools 字段） */
  builtin_tools?: BuiltinToolsConfig;
}

// ── Zod 输入校验 schema ──

/** 内置工具 entry 的 Zod 校验 */
const builtinToolEntrySchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean(),
    need_approval: z.boolean().optional(),
  }),
]);

/** 创建 Agent 的输入校验 */
export const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent 名称不能为空'),
  system_prompt: z.string().optional().default(''),
  model_id: z.string().optional().default(''),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().int().positive().optional().default(4096),
  max_steps: z.number().int().positive().optional().default(10),
  rag_mode: z.string().optional().default('auto'),
  builtin_tools: z.record(z.string(), builtinToolEntrySchema).optional().default({}),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

/** 更新 Agent 的输入校验（所有字段可选） */
export const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  system_prompt: z.string().optional(),
  model_id: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_steps: z.number().int().positive().optional(),
  rag_mode: z.string().optional(),
  kb_id: z.string().nullable().optional(),
  enabled: z.number().min(0).max(1).optional(),
  builtin_tools: z.record(z.string(), builtinToolEntrySchema).optional(),
});

export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

/** 设置/替换 Agent 绑定的知识库（单 KB） */
export const replaceKnowledgeSchema = z.object({
  kb_id: z.string().nullable().optional(),
  mode: z.string().optional().default('auto'),
});

export type ReplaceKnowledgeInput = z.infer<typeof replaceKnowledgeSchema>;
