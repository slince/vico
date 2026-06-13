import { z } from 'zod';

// ── DB 行类型 ──

/** agents 表行类型，与 Drizzle schema 对齐 */
export interface AgentRow {
  id: string;
  tenant_id: string;
  name: string;
  system_prompt: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
  rag_mode: string;
  max_steps: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

/** agent_skills 关联表行类型 */
export interface SkillBinding {
  skill_name: string;
  config: string;
}

/** agent_knowledge_bases 关联表行类型 */
export interface KnowledgeBinding {
  kb_id: string;
  mode: string;
}

// ── 返回类型 ──

/** 列表返回的 Agent（含关联的 skill_names 和 kb_ids） */
export interface AgentWithRelations extends AgentRow {
  skill_names: string[];
  kb_ids: string[];
}

/** 详情返回的 Agent（含完整的 skills 和 knowledge_bases 数据） */
export interface AgentDetail extends AgentRow {
  skills: SkillBinding[];
  knowledge_bases: KnowledgeBinding[];
}

// ── Zod 输入校验 schema ──

/** 创建 Agent 的输入校验 */
export const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent 名称不能为空'),
  system_prompt: z.string().optional().default(''),
  model_id: z.string().optional().default(''),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().int().positive().optional().default(4096),
  max_steps: z.number().int().positive().optional().default(10),
  rag_mode: z.string().optional().default('auto'),
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
  enabled: z.number().min(0).max(1).optional(),
});

export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

/** 替换 Skills 的输入校验 */
export const replaceSkillsSchema = z.object({
  skills: z.array(z.object({
    skill_name: z.string().min(1),
    config: z.record(z.string(), z.any()).optional().default({}),
  })).optional().default([]),
});

export type ReplaceSkillsInput = z.infer<typeof replaceSkillsSchema>;

/** 替换 Knowledge bases 的输入校验 */
export const replaceKnowledgeSchema = z.object({
  knowledge_bases: z.array(z.object({
    kb_id: z.string().min(1),
    mode: z.string().optional().default('auto'),
  })).optional().default([]),
});

export type ReplaceKnowledgeInput = z.infer<typeof replaceKnowledgeSchema>;
