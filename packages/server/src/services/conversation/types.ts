/** 列表返回的对话项 */
export interface ConversationItem {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  title: string;
  model_name: string;
  message_count: number;
  total_tokens: number;
  created_at: number;
  updated_at: number;
  agent_name?: string;
}

/** 消息项 */
export interface MessageItem {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls?: string;
  token_usage: number;
  created_at: number;
}

/** 详情返回的对话（含消息列表） */
export interface ConversationDetail extends ConversationItem {
  messages: MessageItem[];
}

/** Dashboard 最近的对话项（含最后一条消息预览） */
export interface RecentConversation {
  id: string;
  title: string;
  agent_name?: string;
  message_count: number;
  last_message?: string;
  updated_at: number;
}
