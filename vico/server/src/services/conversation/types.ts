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
}

import type { ContentPart } from '@vico/core';

/** 消息项 */
export interface MessageItem {
  id: string;
  thread_id: string;
  role: string;
  /** 原生 ModelMessage.content（parts 数组），含 reasoning/text/tool-call 等全量 parts */
  content: string | ContentPart[];
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
