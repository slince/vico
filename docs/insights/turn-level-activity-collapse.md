# Turn 维度「已完成」折叠块

> 把 `CompletedActivityGroup` 从 message 维度升级到 **turn 维度**：会话完成后，
> 只平铺展示最后一个 assistant 消息，此前所有 assistant 消息统一收进 turn 级
> 「已完成」折叠块；每条消息内部推理、工具调用与文本照常平铺渲染。

---

## 一、目标与语义

- **turn** = 一次「用户 → 助手」往返（含审批/续跑产生的多条 assistant 消息）。
- 会话完成后：
  - **正文（最后一条 assistant 消息）**：正常渲染，推理、工具调用与文本照常平铺。
  - **折叠块**：此前所有 assistant 消息整体收进 `CompletedActivityGroup`，每条
    消息内部推理、工具调用与文本照常平铺，不再做消息级折叠，也不再按「步骤 N」
    拆分标题。
- 时长文案：「已完成，用时 X」仅对实时完成（running → complete）的 turn 显示；
  历史 turn 只显示「已完成」。

## 二、turn 分组算法

结构性切分（`groupMessagesIntoTurns`，`thread.aui.tsx`）：一条 user 消息开启一个
turn，其后的 assistant 消息都属于该 turn。选择结构性切分而非依赖 turnId 的原因：

- 对乐观 user 消息、无文本的纯工具步骤同样稳健；
- turnId 迟到（实时消息）也不会改变分组，`key = turn:${首条消息 id}` 保持稳定，
  避免 React 重挂载。

`turnIdOf` 同时读取历史路径 `metadata.custom.turnId` 与实时登记表
`@/lib/turn-metadata`，目前仅用于 `data-turn-id` 调试属性，不作为分组依据。

## 三、turnId 从后端 → 前端的两条链路

1. **历史消息**：`toAgUiMessages`（`model-to-agui-messages.ts` 的 `metadataOf`）
   在 ag-ui 消息 metadata 顶层写入 `turnId`；前端 `fromAgUiMessages` 的
   `toSnapshotCustom` 把整份 metadata 平铺进 `metadata.custom`，于是
   `metadata.custom.turnId` 可取。
2. **实时消息**：react-ag-ui 的增量路径会丢弃任意 `event.metadata`，因此引擎
   `start` chunk 携带的 turnId 无法落到实时消息 metadata。改为在
   `use-chat-thread-runtime` 订阅 `HttpAgent` 的 `onTextMessageStartEvent`，
   读取原始 `event.metadata.turnId`，登记进 `turn-metadata` 模块 store
   （`messageId → turnId`，`useSyncExternalStore` 驱动重渲染；登记表为有界
   FIFO，超出上限淘汰最旧条目，避免长期会话无界增长）。

引擎侧改动：`packages/stream` 的 `StartPayload` 增加 `turnId`；
`loop-agent.ts` 的 `start` chunk 携带 `session.turn.id`；
`chunk-to-agui.ts` 把 turnId 写入 `RUN_STARTED` 与 `TEXT_MESSAGE_START` 的
metadata（`REASONING_MESSAGE_START` 不携带，前端只订阅文本消息事件）。

注意一个容易踩的边界：`start` 是 turn 级（每个 turn 一次），而 assistant 消息是
**step 级**（每个 `start-step` 一次模型调用即一条）。因此 `chunk-to-agui` 在
`start-step` 时分配新的 assistant `messageId`，文本与工具调用的 `parentMessageId`
都跟随当前 step——不能整个 run 共用一条消息 id，否则审批/续跑产生的多个 step
会被 ag-ui 合并成一条 assistant 消息。

## 四、渲染结构（`thread.aui.tsx` 尾部）

```
ThreadMessageList
  └─ TurnView（key = turn:firstId，跨 turn 生命周期持久）
       ├─ 用户消息（MESSAGE_COMPONENTS）
       └─ 分支：
            ├─ 未完成（running / requires-action / incomplete）
            │     └─ 最后一条消息完整平铺（沿用 AssistantMessage，含推理/工具/思考）
            └─ 已完成
                  ├─ CompletedActivityGroup(elapsed)（仅当 prevMessages.length > 0）
                  │     └─ 中间 assistant 消息 × N（每条经 MESSAGE_COMPONENTS 完整渲染）
                  └─ 最后一条消息（MESSAGE_COMPONENTS 完整渲染）
```

关键点：

- 完成态与未完成态统一走 `MESSAGE_COMPONENTS`（标准 `AssistantMessage`），因此
  推理、工具调用、文本、审批 UI、错误态、分支选择器、操作栏全部复用同一套既有
  实现，没有「正文/活动/步骤」三套切面，也没有消息级折叠。
- 折叠只在最后一条消息 `status.type === "complete"` 且存在中间消息时发生；
  单条 assistant 消息的 turn 不出现 turn 级折叠块（消息内部照常平铺渲染）。
- `useTurnStreamDuration`（`TurnView` 内）以最后一条消息的
  running/requires-action → complete 为打点边界，结算 turn 级时长；`TurnView`
  按 `turn.key` 持久，故状态不会在 turn 间串扰。

## 五、已修改文件

| 文件 | 改动 |
|------|------|
| `packages/stream/src/types.ts` | `StartPayload` 增加 `turnId` |
| `packages/agent/src/loop-agent.ts` | `start` chunk payload 带 `session.turn.id` |
| `packages/stream-ag-ui/src/chunk-to-agui.ts` | turnId 写入 RUN_STARTED / TEXT_MESSAGE_START 的 metadata |
| `vico/web/src/lib/turn-metadata.ts`（新增） | 实时 `messageId → turnId` 登记表 |
| `vico/web/src/hooks/use-chat-thread-runtime.ts` | 订阅 `onTextMessageStartEvent` 登记 turnId |
| `vico/web/src/components/assistant-ui/elements/thread.aui.tsx` | turn 分组 + 渲染管线（折叠块收中间消息） |
| `vico/web/src/components/assistant-ui/elements/message-run-activity.tsx` | `CompletedActivityGroup` 增加 `elapsed` prop |

## 六、遗留与边界

- 折叠块内的中间消息若含待审批工具（审批/续跑场景），仍会渲染其审批 UI；这是沿用
  `part.toolUI` 的既有行为，未单独做「已决议」降级。
- `source` part 沿用旧行为（默认不渲染），未在本轮补齐渲染。
- `data-turn-id` 目前仅作调试属性，turnId 尚未承载分组或持久化职责。
