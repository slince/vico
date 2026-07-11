// @vico/agent - TurnOutput: runTurn 的返回值，封装流和结果
import type { TurnResult } from './agent-loop-options.js';
import type { ModelStreamChunk } from '../model/types.js';

/** runTurn 的返回值，包含输出流、结果 Promise 和控制方法 */
export class TurnOutput {
  /** 模型输出流 */
  readonly stream: ReadableStream<ModelStreamChunk>;

  /** turn 完成后的最终结果 */
  readonly result: Promise<TurnResult>;

  private _abort: () => void;

  constructor(
    stream: ReadableStream<ModelStreamChunk>,
    result: Promise<TurnResult>,
    abort: () => void,
  ) {
    this.stream = stream;
    this.result = result;
    this._abort = abort;
  }

  /**
   * 中断当前 turn 执行。
   */
  abort(): void {
    this._abort();
  }

  /**
   * 等待 turn 完成并返回全部文本（忽略 reasoning、tool 等输出）。
   *
   * @returns 拼接后的完整文本内容
   */
  async collectText(): Promise<string> {
    const reader = this.stream.getReader();
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'text-delta') {
          text += value.delta;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return text;
  }
}
