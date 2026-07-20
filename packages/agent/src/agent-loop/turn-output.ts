// @vico/agent - TurnOutput: runTurn 的返回值，封装流和结果
import type {TurnResult} from './agent-loop-options.js';
import type {AgentStreamPart} from './stream-parts.js';

/** runTurn 的返回值，包含输出流、结果 Promise 和控制方法 */
export class TurnOutput {
  /** 引擎输出流（TextStreamPart 协议） */
  readonly stream: ReadableStream<AgentStreamPart>;

  /** turn 完成后的最终结果 */
  readonly result: Promise<TurnResult>;

  private _abort: () => void;

  constructor(
    stream: ReadableStream<AgentStreamPart>,
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
