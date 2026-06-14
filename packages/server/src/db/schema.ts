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
  is_default: integer('is_default').notNull().default(0),
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

// chunks 表已移除 — 被 Mastra LibSQLVector 接管

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

/** 评估数据集表 */
export const eval_datasets = sqliteTable('eval_datasets', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  name: text('name').notNull(),
  agent_id: text('agent_id').notNull(),
  created_at: integer('created_at').notNull(),
});

/** 评估测试用例表 */
export const eval_test_cases = sqliteTable('eval_test_cases', {
  id: text('id').primaryKey(),
  dataset_id: text('dataset_id').notNull().references(() => eval_datasets.id, { onDelete: 'cascade' }),
  input: text('input').notNull(),
  expected_tools: text('expected_tools'),
  reference_answer: text('reference_answer'),
  created_at: integer('created_at').notNull(),
});

/** 评估运行记录表 */
export const eval_runs = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  dataset_id: text('dataset_id').notNull().references(() => eval_datasets.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  total_cases: integer('total_cases').notNull().default(0),
  completed_cases: integer('completed_cases').notNull().default(0),
  overall_score: real('overall_score'),
  scorer_scores: text('scorer_scores'),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
});

/** 单条用例评估结果表 */
export const eval_case_results = sqliteTable('eval_case_results', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => eval_runs.id, { onDelete: 'cascade' }),
  case_id: text('case_id').notNull(),
  input: text('input').notNull(),
  actual_output: text('actual_output').notNull(),
  scores: text('scores').notNull(),
  details: text('details'),
  tool_calls: text('tool_calls'),
  latency: integer('latency').notNull().default(0),
});
