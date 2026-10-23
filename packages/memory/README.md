# @vico/memory

双层记忆 + 会话历史。

语义记忆（SemanticMemory）、情景记忆（EpisodicMemory）、程序记忆（ProceduralMemory）、会话历史与记忆管理工具，统一由 `MemoryStore` 装配。

## 快速使用

```ts
import { MemoryStore, ConversationHistoryMemory, FileSemanticMemory } from '@vico/memory';
import { InMemoryThreadStore } from '@vico/thread';

const thread = new InMemoryThreadStore();
const memory = new MemoryStore({
  // 会话历史：摘要 + 最近 10 轮已完成 turn
  conversation: new ConversationHistoryMemory(thread, 10),
  // 语义记忆：每个用户一个 Markdown 文件
  semantic: new FileSemanticMemory({ dir: './data/memory' }),
});

await memory.semantic?.set('user-1', '# 用户画像\n偏好中文回复');
const profile = await memory.semantic?.get('user-1');
```

## 相关文档

- [memory 术语重命名](../../docs/insights/memory-terminology-rename.md)
