/** 导出所有 Drizzle 表定义，供 drizzle-kit 生成迁移 */
export { user, session, account, verification, organization, member, invitation } from './auth-schema';
// 以下 5 表已移交 Mastra 接管，不再导出：
//   chunks, conversations, messages, tool_call_logs, token_usage_logs
export { model_configs, agents, memory_entries, installed_skills, agent_skills, knowledge_bases, agent_knowledge_bases, agentTeams, agentTeamMembers } from './schema';
