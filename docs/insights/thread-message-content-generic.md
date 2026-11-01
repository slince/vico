# 线程消息 content 泛型化与序列化边界下沉

> 日期：2026-11-02

## 背景

`@vico/thread` 的 `Message` 是持久化消息条目，`content` 字段原为 `string`，
约定存 `JSON.stringify(ModelMessage.content)`；`fromModelMessage` / `toModelMessages`
在互转时各自做序列化 / 反序列化。序列化职责散落在互转函数里，既增加每轮
转换开销，也让 `Message.content` 的语义（JSON 字符串）偏离其原生形态。

## 改动

1. **`Message` 泛型化**：`Message<TContent = MessageContent>`，默认
   `MessageContent = ModelMessage['content']`（string 或 parts 数组）。
2. **互转不再做 JSON**：`fromModelMessage` / `toModelMessages` 直接透传 content，
   不再 `JSON.stringify` / `JSON.parse`。
3. **序列化下沉到存储边界**：新增 `serializeContent` / `deserializeContent`，由
   `thread-libsql` / `thread-mysql` 在 DB 列（TEXT）读写时调用；
   `deserializeContent` 对历史脏数据按纯文本兜底。

## 关键点

- DB 存储格式不变（content 仍为 JSON 字符串），**无需数据迁移**。
- 内存实现 `InMemoryThreadStore` 直接存对象，不做任何序列化。
- 摘要消息（role='summary'）的 content 也改为直接存字符串文本，读写链路统一。

## 文件索引

- `packages/thread/src/thread-store.ts` — `Message` 泛型 + `MessageContent`
- `packages/thread/src/utils.ts` — 互转透传 + `serializeContent` / `deserializeContent`
- `packages/thread-libsql/src/libsql-thread-store.ts` / `thread-mysql` — 落库 / 读库时序列化
- `packages/compaction/src/model-context-compactor.ts` — 摘要 content 不再二次 JSON.stringify
- `vico/server/src/services/thread/thread-manager.ts` — 删除 `parseMessageContent`
