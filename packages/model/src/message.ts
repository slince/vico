// @vico/model - 模型消息载体类型：原生 ModelMessage 附 id / turnId / usage 扩展
import type {ModelMessage} from '@ai-sdk/provider-utils';
import type {UsageMetrics} from '@vico/types';

/**
 * Agent 内部统一消息载体：原生 ModelMessage 附 id、所属 turnId 与可选 usage。
 *
 * id 必传，且贯穿「内存消息链 → 持久化 → 历史接口 → 前端渲染」：
 * 保证流式期间的 assistant 消息与刷新后从历史加载的同一条消息是同一个标识
 * （前端按 id 做 diff / 编辑 / 滚动锚点，id 变化会被当成新消息）。
 *
 * turnId 可选：turn 由引擎在 `startTurn` 时开启，客户端发出请求时尚不知道本轮 turnId，
 * 因此前端 - 后端这条链路上允许缺失，落库时由引擎按当前 turn 统一补写
 * （`persistMessages` 以上下文 turn.id 覆盖）。历史接口返回的消息会带上 turnId。
 *
 * usage 可选：该次调用的完整用量，仅 assistant 消息携带；只在持久化副本上挂载，
 * 不随上下文发往模型（token-estimator 的 measure 以它为 token 估算基线）。
 */
export type AgentMessage = ModelMessage & { id: string; turnId?: string; usage?: UsageMetrics };
