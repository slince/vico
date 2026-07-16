// @vico/agent - UI 流类型（直接复用 AI SDK 原生类型）
import type { UIMessage } from 'ai';

/** Agent.stream/invoke 接受的消息类型：纯文本字符串或原生 UIMessage 数组 */
export type UserMessage = string | UIMessage[];
