# Context Processor 洋葱模型改造

## 背景

`@vico/context` 原本自研一套「enter/leave 两段式」处理器管道：`ContextProcessor` 定义 `process(ctx)`（进入段）
与可选 `resolve(ctx)`（离开段），`ProcessorPipeline` 手写排序 + 两轮循环（升序 enter、降序 leave）。

这与 `@vico/utils` 新增的通用洋葱模型（Koa 风格 `compose` + `Pipeline`）职责重叠，故把 context 包的机制
收敛到通用模型上，删除手写排序与两段式循环。

## 改了什么

### 1. `ContextProcessor` 变成洋葱层

```ts
export interface ContextProcessor {
  readonly name: string;
  readonly priority: number; // 越小越靠外（先执行）
  handle(ctx: ModelRequestContext, next: Next): void | Promise<void>;
}
```

- 结构上就是 `@vico/utils` 的 `PriorityMiddleware<ModelRequestContext>` 再补一个 `name`（日志用），
  因此可直接喂给 `Pipeline.use()`。
- 语义：`next()` 前 = 原 `process`（进入段）；`next()` 返回后 = 原 `resolve`（离开段）；不调 `next()` 即短路。

### 2. `ProcessorPipeline` 变成 `Pipeline` 的薄封装

```ts
export class ProcessorPipeline {
  private readonly pipeline = new Pipeline<ModelRequestContext>();
  constructor(readonly processors: ContextProcessor[]) {
    this.pipeline.use(...processors);
  }
  execute(ctx: ModelRequestContext, core?: Next): Promise<void> {
    return this.pipeline.execute(ctx, core);
  }
}
```

排序/执行全部下沉给 `@vico/utils` 的 `compose`（priority 升序，同优先级保持传入顺序）。

### 3. 各处理器 `process`/`resolve` 合并为 `handle(ctx, next)`

`SystemPrompt` / `Skill` / `WorkspaceTool` / `Rag` 只有进入段，末尾 `await next()` 放行；
`MemoryProcessor` 进入段注入三类记忆，`next()` 后落库情景记忆。

### 4. 消费方 `loop-agent` 由 enter/leave 改为 execute

原：

```ts
await this.pipeline.enter(requestContext);
// ... 构建 context、跑 loop ...
await this.pipeline.leave(context.ctx); // 非暂停路径
```

现：

```ts
await this.pipeline.execute(requestContext, async () => {
  // ... 构建 context、runLoop ...
  if (loopResult.status !== 'paused') context.ctx.completed = true;
});
return this.finalizeTurn(context, loopResult);
```

## 关键决策

- **暂停跳过 resolve 用 in-band 标记**：`ModelRequestContext` 新增 `completed`（默认 `false`），洋葱核心在
  非暂停完结时置 `true`；`MemoryProcessor` 的离开段据此跳过情景记忆落库。保持「暂停等待审批时不落情景记忆」的
  原行为（跨层信号走 ctx 状态，不走 options 旁路）。
- **离开段异常静默**：情景记忆落库是非关键路径，`MemoryProcessor` 在 `next()` 后自行 try-catch 并
  `console.warn`，不阻塞 turn 完结（对应原 `leave` 的吞错行为）。进入段异常仍向外传播。
- **finish part 仍为流内最后一个事件**：洋葱核心只含「构建 context + runLoop」，`finalizeTurn`（落库 + 终结流）
  放在 `execute` 之后，保证 resolve（情景记忆落库）先于 `finishPart` 完成，流结束语义与原实现一致。

## 相关

- 通用洋葱实现：`packages/utils/src/compose.ts`、`pipeline.ts`
- 消费方：`packages/agent/src/loop-agent.ts`（`startTurn` / `finalizeTurn`）
