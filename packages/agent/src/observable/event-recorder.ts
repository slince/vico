// @vico/agent - EventRecorder port interface + Mitt-based implementation
import mitt, { type Emitter } from 'mitt';
import type { EventPayload, EventRecorder, TypedEvent } from './types.js';

/** 将 event 联合类型转为 mitt 的 EventMap（{ type1: payload1, type2: payload2, '*': TEvent }） */
type MittEventMap<TEvent extends TypedEvent> = {
  [K in TEvent['type']]: EventPayload<TEvent, K>;
} & {
  '*': TEvent;
};

/** 基于 mitt 的 EventRecorder 实现。TEvent 为事件联合类型，可传入 TurnEvent 获得类型安全监听 */
export class MittEventRecorder<TEvent extends TypedEvent = TypedEvent>
  implements EventRecorder<TEvent> {
  private emitter: Emitter<MittEventMap<TEvent>>;

  constructor() {
    const createEmitter = mitt as unknown as <T extends Record<string, unknown>>() => Emitter<T>;
    this.emitter = createEmitter<MittEventMap<TEvent>>();
  }

  emit(event: TEvent): void {
    this.emitter.emit(event.type as keyof MittEventMap<TEvent> & string, event as any);
  }

  on<K extends string>(event: K, handler: (data: EventPayload<TEvent, K>) => void): void {
    this.emitter.on(event as any, handler as any);
  }

  off<K extends string>(event: K, handler: (data: EventPayload<TEvent, K>) => void): void {
    this.emitter.off(event as any, handler as any);
  }
}
