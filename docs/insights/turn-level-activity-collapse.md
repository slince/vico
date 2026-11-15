# Turn 维度「已完成」折叠块

> 把 `CompletedActivityGroup` 从 message 维度升级到 **turn 维度**：会话完成后，
> 只把最后一个 assistant 消息的正文展示出来，此前所有 assistant 消息（以及最后
> 一条消息自身的推理/工具活动）统一收进 turn 级「已完成」折叠块。

---

## 一、目标与语义

- **turn** = 一次「用户 → 助手」往返（含审批/续跑产生的多条 assistant 消息）。
- 会话完成后：
  - **正文**：只展示最后一条 assistant 消息的文本与内容类 part（file/image/data）。
  - **折叠块**：中间 assistant 消息按「步骤 N」分组平铺，加上最后一条消息自身的
    推理 + 工具活动。
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
   （`messageId → turnId`，`useSyncExternalStore` 驱动重渲染）。

引擎侧改动：`packages/stream` 的 `StartPayload` 增加 `turnId`；
`loop-agent.ts` 的 `start` chunk 携带 `session.turn.id`；
`chunk-to-agui.ts` 把 turnId 写入 `RUN_STARTED` / `TEXT_MESSAGE_START` /
`REASONING_MESSAGE_START` 的 metadata。

## 四、渲染结构（`thread.aui.tsx` 尾部）

```
ThreadMessageList
  └─ TurnView（key = turn:firstId，跨 turn 生命周期持久）
       ├─ 用户消息（MESSAGE_COMPONENTS）
       └─ 分支：
            ├─ 未完成（running / requires-action / incomplete）
            │     └─ 最后一条消息完整平铺（沿用 AssistantMessage，含推理/工具/思考）
            └─ 已完成
                  ├─ CompletedActivityGroup(elapsed)（仅当 hasTurnActivity）
                  │     ├─ TurnStep × N（中间消息，stepGroupBy 完整平铺）
                  │     └─ 最后一条消息的活动（answerActivityGroupBy：只留推理+工具）
                  └─ 正文（answerGroupBy：只隐藏推理+工具，保留文本/文件/图片/数据）
```

关键点：

- 通过 `ThreadPrimitive.Unstable_MessageById` 按 id 渲染同一消息的不同切面
  （正文 / 活动 / 步骤），各自套不同的 `groupPartByType` 与组件配置。
- 未完成态沿用原 `AssistantMessage`，因此审批 UI、错误态、流式思考指示都保持原样；
  折叠只在最后一条消息 `status.type === "complete"` 时发生。
- `useTurnStreamDuration`（`TurnView` 内）以最后一条消息的
  running/requires-action → complete 为打点边界，结算 turn 级时长；`TurnView`
  按 `turn.key` 持久，故状态不会在 turn 间串扰。

## 五、已修改文件

| 文件 | 改动 |
|------|------|
| `packages/stream/src/types.ts` | `StartPayload` 增加 `turnId` |
| `packages/agent/src/loop-agent.ts` | `start` chunk payload 带 `session.turn.id` |
| `packages/stream-ag-ui/src/chunk-to-agui.ts` | turnId 写入 RUN_STARTED / 消息事件 metadata |
| `vico/web/src/lib/turn-metadata.ts`（新增） | 实时 `messageId → turnId` 登记表 |
| `vico/web/src/hooks/use-chat-thread-runtime.ts` | 订阅 `onTextMessageStartEvent` 登记 turnId |
| `vico/web/src/components/assistant-ui/elements/thread.aui.tsx` | turn 分组 + 渲染管线 |
| `vico/web/src/components/assistant-ui/elements/message-run-activity.tsx` | `CompletedActivityGroup` 增加 `elapsed` prop |
| `vico/web/src/i18n/locales/*/assistant.json` | 新增 `message.step` 文案 |

## 六、遗留与边界

- 历史中间步骤若含待审批工具（审批/续跑场景），步骤内仍会渲染其审批 UI；这是沿用
  `part.toolUI` 的既有行为，未单独做「已决议」降级。
- `source` part 在正文/步骤中沿用旧行为（默认不渲染），未在本轮补齐渲染。
- `data-turn-id` 目前仅作调试属性，turnId 尚未承载分组或持久化职责。
