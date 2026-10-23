# @vico/events

事件记录与广播（零内部依赖的叶子包），基于 mitt。

## 快速使用

```ts
import { MittEventRecorder, type TypedEvent } from '@vico/events';

// 自定义事件联合类型，on/emit 均获得类型推导
type MyEvent = { type: 'ping'; value: number } | { type: 'pong'; value: string };

const events = new MittEventRecorder<MyEvent>();
events.on('ping', (e) => console.log(e.value));
events.emit({ type: 'ping', value: 1 });
```

