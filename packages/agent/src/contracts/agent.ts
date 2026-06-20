// @vico/agent - AgentConfig and ModelRef Zod schemas
import { z } from 'zod';
import type { ToolStore } from '../tool/types.js';
import type { SkillStore } from '../skill/types.js';

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
};
export type ModelRef = z.infer<typeof ModelRefSchema>;
