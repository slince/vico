// @vico/utils - forwardToController: 将 ReadableStream 泵入外部 ReadableStreamDefaultController 的转发工具

/**
 * 将流泵入外部 controller，并容忍 controller 提前关闭。
 *
 * enqueue 失败（客户端断开、controller 已 close）时静默丢弃后续 chunk，
 * 但仍继续读完上游流——保证上游缓冲流完成累积，依赖流读取完成的 promise 不悬挂。
 * 底层流错误则随 pipeTo 抛给调用方。
 *
 * @param stream - 待转发的可读流
 * @param controller - 目标流控制器（ReadableStreamDefaultController）
 */
export async function forwardToController<T>(
  stream: ReadableStream<T>,
  controller: ReadableStreamDefaultController<T>,
): Promise<void> {
  await stream.pipeTo(new WritableStream<T>({
    write(chunk) {
      try {
        controller.enqueue(chunk);
      } catch {
        // controller 已关闭（客户端断开）：静默丢弃，仅继续读流
      }
    },
  }));
}
