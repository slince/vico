| ModelMessage（模型层） | SessionStore.Message（持久化层） | 
|---|---| 
| 结构 | { role, content, toolCallId?, toolCalls? } | { id, threadId, turnId, role, content, toolCalls?, toolResults? } | 
| 工具调用 | toolCalls 数组在 assistant 消息上 | toolCalls + toolResults 分开 | 
| 工具结果 | 每条 tool result 是独立消息，带 toolCallId | toolResults 数组挂在消息上 |