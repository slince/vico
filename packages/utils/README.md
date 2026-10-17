# @vico/utils

通用工具库（零内部依赖的叶子包）：栈、按键互斥锁、Map 合并。

## 快速使用

```ts
import { Stack, KeyedMutex, mergeMaps } from '@vico/utils';

// 后进先出栈
const stack = new Stack<string>();
stack.push('a');
stack.push('b');
stack.pop(); // 'b'
stack.peek(); // 'a'

// 按 key 分片的异步互斥锁：同一 key 严格串行，不同 key 互不阻塞
const mutex = new KeyedMutex();
await mutex.run('user-1', async () => {
  // 同一 scopeId 的并发写在此串行化
});

// 合并多个 Map（后面的覆盖前面的同名 key）
const merged = mergeMaps(new Map([['a', 1]]), new Map([['b', 2]]));
```

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
