import type { ContentPart, Thread } from '@vico/core';

/** 列表返回的线程项 — 在 Thread 基础上附加可见消息计数 */
export interface ThreadItem extends Thread {
  /** 可见消息总数（不含 tool 角色） */
  messageCount: number;
}

/** 消息项 */
export interface MessageItem {
  id: string;
  threadId: string;
  role: string;
  /** 原生 ModelMessage.content（parts 数组），含 reasoning/text/tool-call 等全量 parts */
  content: string | ContentPart[];
  createdAt: number;
}

/** 暂停中的待审批工具调用 */
export interface PendingToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** 详情返回的线程（含消息列表） */
export interface ThreadDetail extends ThreadItem {
  messages: MessageItem[];
  /** 是否暂停中（等待工具审批） */
  paused?: boolean;
  /** 暂停时待审批的工具调用 */
  pendingToolCalls?: PendingToolCall[];
}

/** Dashboard 最近的线程项（含最后一条消息预览） */
export interface RecentThread {
  id: string;
  title: string;
  agentName?: string;
  messageCount: number;
  lastMessage?: string;
  updatedAt: number;
}
