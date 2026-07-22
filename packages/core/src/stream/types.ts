// @vico/core - UI 流类型（直接复用 AI SDK 原生类型）
import type { ModelMessage, UIMessage } from 'ai';

/**
 * Agent.stream/invoke 接受的消息类型：
 * - `string` — 纯文本，转为单条 user 消息
 * - `UIMessage[]` — useChat 原生消息（含历史），校验转换后取最后一条作为本轮输入
 * - `ModelMessage[]` — 原生模型消息组，原样作为本轮输入（调用方全权控制，如 few-shot、预置上下文）
 */
export type UserMessage = string | UIMessage[] | ModelMessage[];
