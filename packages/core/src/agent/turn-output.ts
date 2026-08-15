// @vico/core - TurnOutput: runTurn 的返回值，封装流和结果
import type {TextStreamPart, ToolSet} from 'ai';
import type {TurnResult} from './loop-agent-options.js';

/** runTurn 的返回值，包含输出流、结果 Promise 和控制方法 */
export class TurnOutput {
  /** 引擎输出流（TextStreamPart 协议） */
  readonly stream: ReadableStream<TextStreamPart<ToolSet>>;

  /** turn 完成后的最终结果 */
  readonly result: Promise<TurnResult>;

  private _abort: () => void;

  constructor(
    stream: ReadableStream<TextStreamPart<ToolSet>>,
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
}
