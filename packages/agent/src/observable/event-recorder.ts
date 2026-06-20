// @vico/agent - EventRecorder port interface: SSE event broadcasting
import type { SSEEvent } from '../contracts/events.js';

/** SSE 事件广播器端口 */
export interface EventRecorder {
  /** 发射 SSE 事件 */
  emit(event: SSEEvent): void;
  /** 注册事件监听器 */
  on(event: string, handler: (data: unknown) => void): void;
  /** 移除事件监听器 */
  off(event: string, handler: (data: unknown) => void): void;
}
