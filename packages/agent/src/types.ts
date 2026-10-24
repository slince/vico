// @vico/agent - Agent turn 生命周期事件类型

import type { Thread, Turn } from '@vico/thread';

/**
 * turn 生命周期事件：覆盖一次 turn 从开始到结束、以及其中每个 step 的边界。
 *
 * 用于订阅 agent 执行进度（埋点、进度展示、可观测性等）：
 * - `turn.start` — turn 开始执行前（turn 已创建，尚未进入 step loop）
 * - `turn.end`   — turn 执行结束（正常完成 / 暂停 / 失败 / 中止等终态）
 * - `step.start` / `step.end` — 单个 step 的开始与结束
 *
 * 满足 `@vico/events` 的 `TypedEvent` 约束（含 `type` 判别字段），
 * 可直接作为 `EventRecorder<TurnEvent>` 的事件联合使用。
 */
export type TurnEvent =
  /** turn 开始执行前，携带所属 thread 与 turn 实例 */
  | { type: 'turn.start'; thread: Thread; turn: Turn }
  /** turn 执行结束，携带所属 thread 与 turn 实例 */
  | { type: 'turn.end'; thread: Thread; turn: Turn }
  /** 单个 step 开始，`step` 为 turn 内单调递增的 step 序号 */
  | { type: 'step.start'; step: number }
  /** 单个 step 结束，`step` 为 turn 内单调递增的 step 序号 */
  | { type: 'step.end'; step: number };
