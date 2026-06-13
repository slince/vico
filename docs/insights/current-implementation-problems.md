# 当前实现问题诊断与调整方向

> 本文档以最严格的工程标准审视 Vico 当前实现，不回避任何设计缺陷。
> 每个问题包含：现状描述 → 问题本质 → 调整方向。
> 已解决的问题会从本文档中移除。

---

## 一、Agent 引擎层问题

### 1.1 正则提取事实：用锤子敲螺丝

**现状:** WorkingMemory 的事实提取完全依赖正则表达式。当前版本已有所改进——增加了英文模式匹配和否定句式过滤（`negationMarkers`）——但本质仍是硬编码的正则：

```
/我(?:喜欢|偏好|习惯|想要|希望|更倾向于)(.+)/
/(?:以后|下次|将来|每次)(.+)/
/I\s(?:like|prefer|love|enjoy|want|hope|wish)\s+(.+)/i
```

**问题本质:** 这是用 1980 年代的技术做 2026 年的 AI 产品。

- "我不喜欢太啰嗦的回答" → 否定过滤可以拦截，但依赖模式完整度
- "我以后再也不相信天气预报了" → 同上
- "我在北京工作，但我更喜欢远程办公" → 只匹配前半句
- 隐含偏好？"上次那个方案太复杂了" → 什么都匹配不到
- 长句中的嵌套否定？"我觉得不喜欢用表格其实不对" → 正则无法理解语义

好消息是 `extractAndStore` 被标记为 `.catch(() => {})` 异步丢弃，意味着提取失败不会影响用户体验。坏消息是：它大概率也提取不到什么有用的东西，用户在对话中透露的偏好 90% 以上不会命中这几个正则。

**调整方向:**

1. 用 LLM 做事实提取（在 onFinish 回调中用一次额外的轻量 LLM 调用，或复用 streamText 的 response 做结构化提取）
2. 这一步已经是最佳时机——对话刚完成，上下文完整，一次 `generateObject` + Zod schema 就能提取结构化事实
3. 如果担心成本/延迟，至少用 embedding 相似度 + 预定义事实类别做分类，而不是 9 个正则打天下

---

## 二、前端层问题

### 2.1 SSE 解析：自己造轮子

**现状:** `api/client.ts` 的 `streamChat` 和 `streamTeamChat` 手动实现了 SSE 解析：`fetch` → `response.body.getReader()` → `TextDecoder` → 按 `\n` 分割 → 检查 `data:` 前缀 → `JSON.parse`。两段代码几乎完全重复。

**问题本质:** AI SDK 的 `@ai-sdk/react` 已经提供了 `useChat` hook，自动处理 SSE 流、消息状态管理、abort、重连。当前实现等于用 fetch 重新发明了 AI SDK 的 streaming client。

**调整方向:**

1. 评估是否可以直接使用 AI SDK 的 `useChat`（需要后端兼容其 API 格式）
2. 如果不能（因为后端格式是自定义的），至少封装一个 `useSSEStream` hook，消除 `streamChat` 和 `streamTeamChat` 的重复代码

---

## 三、工程质量问题

### 3.1 零测试覆盖率

**现状:** 现有 4 个测试文件：`crypto.test.ts`、`observational-memory.test.ts`、`working-memory.test.ts`、`teams.test.ts`。比早期的 2 个有所增长，但核心模块——agent-factory、sse-utils、model-registry、skill-tool-adapter、rag-tool、skill-manager——仍零测试覆盖。

**问题本质:** agent-factory 和 sse-utils 这样的核心业务流程，没有测试意味着：

- 修改 model 解析逻辑时不知道是否影响所有 provider
- 修改 SSE 事件格式时不知道前端是否兼容
- 添加新 processor 时没有回归测试

**调整方向:**

1. 优先为 agent-factory 的核心纯函数写单元测试：`resolveModelProvider`、prompt 组装逻辑
2. 集成测试至少覆盖：创建 Agent → 发送消息 → 验证 SSE 事件格式
3. 用 mock AI SDK 隔离 LLM 调用
