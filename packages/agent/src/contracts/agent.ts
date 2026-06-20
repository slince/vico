import { z } from 'zod';

export const AgentConfigSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  systemPrompt: z.string(),
  modelId: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  skillIds: z.array(z.string()),
  knowledgeBaseIds: z.array(z.string()),
  ragMode: z.enum(['disabled', 'auto', 'always']),
  maxSteps: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  })).optional(),
  createdAt: z.number(),
});

export const AgentContextSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  agentId: z.string(),
  threadId: z.string(),
  history: z.array(MessageSchema),
  stmWindow: z.number().int().positive(),
  userMessage: z.string(),
  workspace: z.string().optional(),
});
