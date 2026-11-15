"use client";

/**
 * 实时流消息的 turn 归属登记表。
 *
 * 历史消息的 turnId 由后端经 `toAgUiMessages` 写入 `metadata.custom.turnId`，
 * 而实时流消息（react-ag-ui 的增量路径）不会透传任意 event.metadata。这里
 * 由 `use-chat-thread-runtime` 在订阅到 TEXT_MESSAGE_START 时登记
 * `messageId → turnId`，供 turn 聚合渲染在实时消息上取回归属。
 */
import { useSyncExternalStore } from "react";

/** messageId → turnId 登记表（消息 id 为全局唯一 UUID，无需按线程清理） */
const turnIdByMessageId = new Map<string, string>();

/** 订阅者集合（触发 React 重渲染） */
const listeners = new Set<() => void>();

/** 单调递增版本号：任何登记变更都会递增，作为 useSyncExternalStore 的快照 */
let version = 0;

/** 通知所有订阅者登记表已变化 */
function emitChange(): void {
  listeners.forEach((listener) => listener());
}

/**
 * 登记一条实时消息所属的 turn。
 *
 * 幂等：同一 messageId 的 turnId 不变时不触发变更通知。
 *
 * @param messageId - 实时 assistant 消息 id
 * @param turnId - 该消息所属 turn 的 id
 */
export function recordMessageTurnId(messageId: string, turnId: string): void {
  if (turnIdByMessageId.get(messageId) === turnId) return;
  turnIdByMessageId.set(messageId, turnId);
  version += 1;
  emitChange();
}

/**
 * 读取一条消息登记的 turn id（未登记返回 undefined）。
 *
 * @param messageId - 消息 id
 * @returns 该消息所属 turn 的 id
 */
export function getMessageTurnId(messageId: string): string | undefined {
  return turnIdByMessageId.get(messageId);
}

/**
 * 订阅登记表版本号，任一登记变更都会触发当前组件重渲染。
 *
 * 供 turn 聚合的 useMemo 依赖，确保实时消息拿到 turnId 后重新分组。
 *
 * @returns 当前版本号（仅作变化信号使用）
 */
export function useLiveTurnIdsVersion(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => version,
  );
}
