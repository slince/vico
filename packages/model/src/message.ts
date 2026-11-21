// @vico/model - 模型消息载体类型：原生 ModelMessage 附 usage / turnId 扩展
import type {ModelMessage} from '@ai-sdk/provider-utils';
import type {UsageMetrics} from '@vico/types';

/**
 * 可持久化消息：原生 ModelMessage 附带可选 usage（该次调用的完整用量，仅 assistant 消息携带）。
 * 与 AgentMessage 的区别在于不要求自带 turnId —— 持久化时 turnId 由持久化方统一补充。
 */
export type PersistableMessage = ModelMessage & { usage?: UsageMetrics };

/**
 * Agent 内部统一消息载体：PersistableMessage 附所属 turnId（必传），消息自描述所属 turn。
 */
export type AgentMessage = PersistableMessage & { turnId: string };
