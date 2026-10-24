// @vico/agent - TurnOutput: runTurn 的返回值，封装流和结果
import type {TextStreamPart, ToolSet} from 'ai';
import type {TurnResult} from './loop-agent-options.js';

/**
 * runTurn 的返回值，包含输出流、结果 Promise 和控制方法。
 * 对齐 BufferedModelStream 的驱动机制：result() 在流未被消费时主动读取一次，
 * 驱动 turn 产出并回收最终结果；已被消费（如 SSE 转发）则直接等待其读完。
 */
export class TurnOutput {
  /** 引擎输出流（TextStreamPart 协议） */
  readonly stream: ReadableStream<TextStreamPart<ToolSet>>;

  /** turn 完成后的最终结果（由 run() 内部 resolve，永不 reject） */
  private readonly resultPromise: Promise<TurnResult>;

  private readonly abortController: AbortController;

  constructor(
    stream: ReadableStream<TextStreamPart<ToolSet>>,
    resultPromise: Promise<TurnResult>,
    abortController: AbortController,
  ) {
    this.stream = stream;
    this.resultPromise = resultPromise;
    this.abortController = abortController;
  }

  /**
   * 中断当前 turn 执行。
   */
  abort(): void {
    this.abortController.abort();
  }

  /**
   * 完整 turn 结果。
   * 流尚未被消费时主动读取一次以驱动产出；已被消费（stream.locked）则等待其读完。
   */
  async result(): Promise<TurnResult> {
    await this.ensureConsumed();
    return this.resultPromise;
  }

  /** 若流尚未被任何 reader 消费，则主动消费一次以驱动 turn 产出并回收结果 */
  private async ensureConsumed(): Promise<void> {
    if (this.stream.locked) return;
    try {
      const reader = this.stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // 读取错误已由 run() 内的 resolve 承接，此处仅吞掉主动消费的异常
    }
  }
}
