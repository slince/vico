/**
 * Vico 专用 HttpAgent —— 在每次 run 之前写入本线程的真实 threadId。
 *
 * 为什么需要它：`AbstractAgent` 在构造时就把 threadId 固化成随机 UUID；assistant-ui 在每次
 * run 前又会把实例上的 threadId 覆盖成它自己认为的值（新会话草稿阶段可能是空串）。
 * 而 threadId 只会进到「run 的入参」这一处，`HttpAgent` 发出的请求体正是由它派生
 * （`requestInit(prepareRunAgentInput(...))`）。
 *
 * 因此正确的位置只有一个：`runAgent` 的入口。这里先 await 线程解析（必要时 initialize），
 * 再把真实 ID 写回实例属性，请求体随之正确 —— 不需要在 `fetch` 里解析 JSON、重写 body。
 */
import {HttpAgent} from '@ag-ui/client';

type HttpAgentOptions = ConstructorParameters<typeof HttpAgent>[0];
type RunParameters = Parameters<HttpAgent['runAgent']>[0];
type RunSubscriber = Parameters<HttpAgent['runAgent']>[1];
type RunResult = Awaited<ReturnType<HttpAgent['runAgent']>>;

export class VicoHttpAgent extends HttpAgent {
  /**
   * @param resolveThreadId - 每次 run 前解析本线程的真实 ID；返回 undefined 时保持原值
   *                          （由后端按「新建会话」处理，前端不会写错到别的会话）
   * @param options - 原 HttpAgent 配置
   */
  constructor(
    private readonly resolveThreadId: () => Promise<string | undefined>,
    options: HttpAgentOptions,
  ) {
    super(options);
  }

  override async runAgent(
    parameters?: RunParameters,
    subscriber?: RunSubscriber,
  ): Promise<RunResult> {
    const resolvedThreadId = await this.resolveThreadId();
    if (!resolvedThreadId) {
      // 绝不能带着空串/随机 UUID 发出去：后端会把消息落进不存在的会话或报 Thread not found
      throw new Error('未能创建会话，请确认已选择 Agent 后再发送');
    }
    this.threadId = resolvedThreadId;
    return super.runAgent(parameters, subscriber);
  }
}
