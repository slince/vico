/**
 * 历史适配器：接管 assistant-ui 的 `load()`，消息来源是后端 `AgentMessage[]`。
 *
 * 写入方向不做接管 —— 消息由引擎在服务端持久化，客户端 append 只会产生重复数据。
 */
import {ExportedMessageRepository, type ThreadHistoryAdapter} from '@assistant-ui/react';
import type {VicoTransport} from '../types.js';
import {agentMessagesToThreadMessages} from './agent-message-to-thread-message.js';

/** 本地草稿线程 ID 前缀（assistant-ui 在 initialize 之前使用的前端 ID） */
export const LOCAL_THREAD_ID_PREFIX = '__LOCALID_';

/**
 * 判断 ID 是否是后端真实线程 ID（可安全用于历史/请求）。
 *
 * @param id - assistant-ui 给出的线程 ID
 * @returns 是真实后端 ID 时为 true
 */
export function isRemoteThreadId(id: string | undefined): id is string {
  return !!id && !id.startsWith(LOCAL_THREAD_ID_PREFIX);
}

export interface HistoryAdapterOptions {
  transport: VicoTransport;
  /** 真实线程 ID；草稿阶段或加载中为 undefined（此时返回空历史，避免串到别的会话） */
  threadId?: string;
}

/**
 * 创建历史适配器。
 *
 * @param options - 传输实现与线程 ID
 * @returns 供 `useLocalRuntime` 的 `adapters.history` 使用
 */
export function createHistoryAdapter({transport, threadId}: HistoryAdapterOptions): ThreadHistoryAdapter {
  return {
    // 刻意不设 scopeId：local runtime 在 scope 变化时会清空内存仓库后重新 load，
    // 而新会话的 threadId 是在首条消息前后才从 undefined 变成真实 ID 的，
    // 那一次重置会把刚发出的用户消息清掉。每个线程体各自挂一个 runtime，不需要靠 scope 切会话。
    async load() {
      if (!isRemoteThreadId(threadId)) return ExportedMessageRepository.fromArray([]);
      const messages = await transport.loadMessages(threadId);
      return ExportedMessageRepository.fromArray(agentMessagesToThreadMessages(messages));
    },
    async append() {
      // 服务端已按流式结果持久化，客户端不重复写入
    },
  };
}
