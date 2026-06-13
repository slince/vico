import { sqliteTable, text, integer, real, blob, primaryKey, unique } from 'drizzle-orm/sqlite-core';
// 引用 better-auth 管理的表（用于外键约束）
import { user, organization } from './auth-schema.js';

/** 模型配置表 — 每个租户可配置多个 LLM 模型 */
export const model_configs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  provider: text('provider').notNull(),
  model_name: text('model_name').notNull(),
  api_key_encrypted: text('api_key_encrypted').notNull(),
  base_url: text('base_url'),
  is_default: integer('is_default').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

/** Agent 定义表 */
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  name: text('name').notNull(),
  system_prompt: text('system_prompt').notNull().default(''),
  model_id: text('model_id').notNull(),
  temperature: real('temperature').notNull().default(0.7),
  max_tokens: integer('max_tokens').notNull().default(4096),
  rag_mode: text('rag_mode').notNull().default('auto'),
  enabled: integer('enabled').notNull().default(1),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** 已安装的 Skill 表 */
export const installed_skills = sqliteTable('installed_skills', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  skill_name: text('skill_name').notNull(),
  display_name: text('display_name').notNull(),
  version: text('version').notNull(),
  config: text('config').notNull().default('{}'),
  enabled: integer('enabled').notNull().default(1),
  installed_at: integer('installed_at').notNull(),
}, (table) => ({
  unq: unique().on(table.tenant_id, table.skill_name),
}));

/** Agent ↔ Skill 绑定关联表 */
export const agent_skills = sqliteTable('agent_skills', {
  agent_id: text('agent_id').notNull().references(() => agents.id),
  skill_name: text('skill_name').notNull(),
  config: text('config').notNull().default('{}'),
}, (table) => ({
  pk: primaryKey({ columns: [table.agent_id, table.skill_name] }),
}));

/** 知识库表 */
export const knowledge_bases = sqliteTable('knowledge_bases', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  source: text('source').notNull().default('upload'),
  skill_name: text('skill_name'),
  chunk_count: integer('chunk_count').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

/** 知识库分块表 */
export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(),
  kb_id: text('kb_id').notNull().references(() => knowledge_bases.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: blob('embedding').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
});

/** Agent ↔ 知识库绑定关联表 */
export const agent_knowledge_bases = sqliteTable('agent_knowledge_bases', {
  agent_id: text('agent_id').notNull().references(() => agents.id),
  kb_id: text('kb_id').notNull().references(() => knowledge_bases.id),
  mode: text('mode').notNull().default('auto'),
}, (table) => ({
  pk: primaryKey({ columns: [table.agent_id, table.kb_id] }),
}));

/** 对话会话表 */
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  agent_id: text('agent_id').notNull().references(() => agents.id),
  user_id: text('user_id').notNull().references(() => user.id),
  title: text('title').notNull().default(''),
  model_name: text('model_name').notNull(),
  message_count: integer('message_count').notNull().default(0),
  total_tokens: integer('total_tokens').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** 聊天消息表 */
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversation_id: text('conversation_id').notNull().references(() => conversations.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tool_calls: text('tool_calls'),
  token_usage: integer('token_usage').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

/** 长期记忆条目表 */
export const memory_entries = sqliteTable('memory_entries', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  user_id: text('user_id').notNull().references(() => user.id),
  type: text('type').notNull(),
  content: text('content').notNull(),
  embedding: blob('embedding'),
  importance: real('importance').notNull().default(0.5),
  created_at: integer('created_at').notNull(),
  expires_at: integer('expires_at'),
});

/** 工具调用日志表 */
export const tool_call_logs = sqliteTable('tool_call_logs', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  agent_id: text('agent_id').notNull(),
  conversation_id: text('conversation_id').notNull(),
  message_id: text('message_id').notNull(),
  tool_name: text('tool_name').notNull(),
  args: text('args').notNull(),
  result: text('result'),
  status: text('status').notNull(),
  duration_ms: integer('duration_ms').notNull(),
  created_at: integer('created_at').notNull(),
});

/** Token 用量日志表 */
export const token_usage_logs = sqliteTable('token_usage_logs', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull(),
  agent_id: text('agent_id').notNull(),
  model_name: text('model_name').notNull(),
  prompt_tokens: integer('prompt_tokens').notNull(),
  completion_tokens: integer('completion_tokens').notNull(),
  created_at: integer('created_at').notNull(),
});

/** Agent 团队定义表 */
export const agentTeams = sqliteTable('agent_teams', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  routing_strategy: text('routing_strategy').notNull().default('supervisor'),
  supervisor_agent_id: text('supervisor_agent_id').references(() => agents.id),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** 团队成员关联表 */
export const agentTeamMembers = sqliteTable('agent_team_members', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => agentTeams.id, { onDelete: 'cascade' }),
  agent_id: text('agent_id').notNull().references(() => agents.id),
  role: text('role').notNull().default('member'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  unq: unique().on(table.team_id, table.agent_id),
}));
