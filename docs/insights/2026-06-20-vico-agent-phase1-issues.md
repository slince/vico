# Phase 1 审查发现的问题

> 来源：Phase 1 最终全分支代码审查 | 日期：2026-06-20

## Important（Should Fix）

1. **`agent-loop/agent-loop.ts:178-181` — assistant 消息缺 toolCalls 字段**
   - 模型调用工具时，记录的 assistant 消息只有 `content` 文本，未填充 `toolCalls` 字段
   - 影响：多轮对话/上下文压缩时无法还原工具调用历史
   - 修复：在 `messages.push` 时带上 `toolCalls` 数组

2. **`tool/tool-host.ts:2` — 未使用的 ToolPolicy import**
   - ToolPolicy 被导入但文件中无引用
   - 修复：从 import 行中移除 `ToolPolicy`

3. **缺少 `vitest.config.ts`**
   - 当前依赖默认配置运行测试，CI 复现和配置可见性差
   - 修复：添加最小化的 vitest.config.ts，明确 `environment: 'node'` 和 include 模式

4. **`observable/event-recorder.ts:20` — mitt 的 @ts-expect-error 较脆弱**
   - 手动抑制 mitt 的 TS2349 错误，mitt 类型声明更新后可能误抑制其他错误
   - 修复：改用 `// @ts-ignore` 或添加最小类型声明覆盖

## Minor（Nice to Have）

5. **AgentRuntime O(n) 查找** — 部分操作用全量遍历，可加反向索引
6. **ModelStreamChunk 未使用的变体** — `tool_call_delta` 和 `completed` chunk 在协议中定义但适配器不产出
7. **buildPromptContext 中 steer 缓冲区的 TOCTOU** — 当前无害，未来异步注入时需注意
8. **index.ts 缺模块级 JSDoc**
