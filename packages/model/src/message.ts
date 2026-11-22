// @vico/model - 模型消息载体类型：原生 ModelMessage 附 usage / turnId 扩展
import type {ModelMessage} from '@ai-sdk/provider-utils';
import type {UsageMetrics} from '@vico/types';

/**
 * 可持久化消息：原生 ModelMessage 附带可选 usage（该次调用的完整用量，仅 assistant 消息携带）。
 * 与 AgentMessage 的区别在于不要求自带 turnId —— 持久化时 turnId 由持久化方统一补充。
 */
export type PersistableMessage = ModelMessage & { usage?: UsageMetrics };

/**
 * Agent 内部统一消息载体：PersistableMessage 附 id 与所属 turnId。
 *
 * id 必传，且贯穿「内存消息链 → 持久化 → 历史接口 → 前端渲染」：
 * 保证流式期间的 assistant 消息与刷新后从历史加载的同一条消息是同一个标识
 * （前端按 id 做 diff / 编辑 / 滚动锚点，id 变化会被当成新消息）。
 *
 * turnId 可选：turn 由引擎在 `startTurn` 时开启，客户端发出请求时尚不知道本轮 turnId，
 * 因此前端 - 后端这条链路上允许缺失，落库时由引擎按当前 turn 统一补写
 * （`persistMessages` 以上下文 turn.id 覆盖）。历史接口返回的消息会带上 turnId。
 */
export type AgentMessage = PersistableMessage & { id: string; turnId?: string };
