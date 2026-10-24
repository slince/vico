// @vico/utils - AbortSignal 聚合：外部信号联动内部 AbortController

/**
 * 创建一个 AbortController，其 signal 同时受「自身 abort()」与「外部 signal」控制。
 *
 * 外部 signal 已中止时立即 abort 内部控制器；否则监听其 abort 事件并转发到内部控制器。
 * 用于把 TurnOutput.abort() / 流 cancel 与调用方传入的中断信号汇聚到同一信号上。
 *
 * @param external - 外部中断信号，可选；不传则仅由返回的 controller 自身控制
 * @returns 内部 AbortController（通过其 signal 透传聚合后的中断状态）
 */
export function createAggregatedAbortController(external?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return controller;
}
