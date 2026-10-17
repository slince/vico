// @vico/core - 事件类型定义

/** 事件基础约束：每个事件必须包含 type 判别字段 */
export interface TypedEvent {
  type: string;
}

/** 从联合事件类型中按 type 字段提取对应的完整 payload（含 type）。无匹配时回退到完整 TEvent */
export type EventPayload<TEvent extends TypedEvent, K extends string> =
  [Extract<TEvent, { type: K }>] extends [never] ? TEvent : Extract<TEvent, { type: K }>;

/** 事件订阅名：具体事件 type 字面量或 '*' 通配符（订阅全部事件） */
export type EventType<TEvent extends TypedEvent> = TEvent['type'] | '*';

/** 事件广播器端口。TEvent 为事件联合类型 */
export interface EventRecorder<TEvent extends TypedEvent = TypedEvent> {
  /** 发射事件 */
  emit(event: TEvent): void;
  /** 注册事件监听器。K 为事件 type 字面量或 '*' 通配符 */
  on<K extends EventType<TEvent>>(event: K, handler: (data: EventPayload<TEvent, K>) => void): void;
  /** 移除事件监听器 */
  off<K extends EventType<TEvent>>(event: K, handler: (data: EventPayload<TEvent, K>) => void): void;
}
