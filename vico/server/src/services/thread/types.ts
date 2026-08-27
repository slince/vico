import type {Thread} from '@vico/core';
import {UIMessage} from "ai";

/** 列表返回的线程项 — 在 Thread 基础上附加可见消息计数 */
export interface ThreadItem extends Thread {
  /** 可见消息总数（不含 tool 角色） */
  messageCount: number;
}

/** 详情返回的线程（含消息列表） */
export interface ThreadDetail extends ThreadItem {
  messages: UIMessage[];
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
