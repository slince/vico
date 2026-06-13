/** 团队成员 */
export interface Member {
  id: string;
  agent_id: string;
  role: string;
  agent_name: string;
}

/** 团队详情数据形状 */
export interface TeamDetailData {
  id: string;
  name: string;
  description: string;
  routing_strategy: string;
  supervisor_agent_id: string | null;
  members: Member[];
}

/** Agent 选项（下拉选择用） */
export interface AgentOption {
  id: string;
  name: string;
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'delegation';
  content: string;
  agentName?: string;
}
