import { sqliteTable, text, integer, real, primaryKey, unique, index } from 'drizzle-orm/sqlite-core';
// 引用 better-auth 管理的表（用于外键约束）
import { organization, user } from './auth-schema.js';

/** 模型配置表 — 每个租户可配置多个 LLM 模型 */
export const model_configs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  provider: text('provider').notNull(),
  model_name: text('model_name').notNull(),
  api_key: text('api_key_encrypted').notNull(),
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
  max_steps: integer('max_steps').notNull().default(10),
  builtin_tools: text('builtin_tools').notNull().default('{}'),
  kb_id: text('kb_id'),
  is_default: integer('is_default').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

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

// chunks 表已移除 — 被 Mastra LibSQLVector 接管

/** 文档表 — 知识库中单个文件/URL/手动创建的文档记录 */
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  kb_id: text('kb_id').notNull().references(() => knowledge_bases.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  file_type: text('file_type').notNull(),         // 'txt'|'md'|'pdf'|'docx'|'csv'|'html'|'url'|'manual'
  file_size: integer('file_size').notNull().default(0),
  file_hash: text('file_hash'),                    // SHA256，用于去重
  chunk_count: integer('chunk_count').notNull().default(0),
  status: text('status').notNull().default('pending'), // pending|parsing|indexing|ready|error
  error_msg: text('error_msg'),
  tags: text('tags').notNull().default('[]'),       // JSON 数组
  source: text('source').notNull().default('upload'), // upload|url|manual
  source_url: text('source_url'),
  metadata: text('metadata').notNull().default('{}'),
  path: text('path').notNull().default(''),
  storage_key: text('storage_key'),
  parent_id: text('parent_id'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  kbIdx: index('idx_documents_kb_id').on(table.kb_id),
  tenantIdx: index('idx_documents_tenant').on(table.tenant_id),
  kbFileUnq: unique('uq_documents_kb_file').on(table.kb_id, table.file_hash),
  pathIdx: index('idx_documents_kb_path').on(table.kb_id, table.path),
  parentIdx: index('idx_documents_parent_id').on(table.parent_id),
}));

/** Agent ↔ 知识库绑定关联表 */
export const agent_knowledge_bases = sqliteTable('agent_knowledge_bases', {
  agent_id: text('agent_id').notNull().references(() => agents.id),
  kb_id: text('kb_id').notNull().references(() => knowledge_bases.id),
  mode: text('mode').notNull().default('auto'),
}, (table) => ({
  pk: primaryKey({ columns: [table.agent_id, table.kb_id] }),
}));

// tool_call_logs 表已移除 — 被 Processor 审计日志接管
// token_usage_logs 表已移除 — 被 Processor Token 跟踪接管

/** 对话记录表 */
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

/** 消息表 */
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversation_id: text('conversation_id').notNull().references(() => conversations.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tool_calls: text('tool_calls'),
  token_usage: integer('token_usage').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

/** 记忆表 — 工作记忆和观察记忆共享，通过 type 字段区分 */
export const memory_entries = sqliteTable('memory_entries', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull(),
  user_id: text('user_id').notNull().default(''),
  type: text('type').notNull(),
  content: text('content').notNull(),
  importance: real('importance').notNull().default(0.5),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  typeTenantIdx: index('idx_me_tenant_type_imp').on(table.tenant_id, table.type, table.importance),
}));

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

/** 命令执行审批表 */
export const exec_approvals = sqliteTable('exec_approvals', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  agent_id: text('agent_id').notNull().references(() => agents.id),
  command: text('command').notNull(),
  status: text('status').notNull().default('pending'),
  created_at: integer('created_at').notNull(),
  resolved_at: integer('resolved_at'),
}, (table) => ({
  tenantStatusIdx: index('idx_ea_tenant_status').on(table.tenant_id, table.status),
}));

/** Thread — 会话线程表 */
export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  agent_id: text('agent_id').notNull(),
  user_id: text('user_id'),
  title: text('title'),
  metadata: text('metadata'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** Thread — 对话轮次表 */
export const turns = sqliteTable('turns', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('running'),
  steps: integer('steps').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

/** Thread — 消息表 */
export const thread_messages = sqliteTable('thread_messages', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  turn_id: text('turn_id').notNull().references(() => turns.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tool_calls: text('tool_calls'),
  tool_results: text('tool_results'),
  metadata: text('metadata'),
  created_at: integer('created_at').notNull(),
});
