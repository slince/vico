/**
 * usePersistedState — 与持久化存储同步的 React state。
 *
 * 初始值从存储读取，变化后写回；读取/写入异常（隐私模式、SSR 等）静默回退到
 * 默认值。当前实现基于 localStorage，若将来更换为 cookie 等后端，只需改动内部
 * 读写，调用方无需感知。默认 JSON 序列化，可用 options 覆盖以兼容裸字符串等旧格式。
 */
import { useEffect, useRef, useState } from 'react';

type Serialize<T> = (value: T) => string;
type Deserialize<T> = (raw: string) => T;

const JSON_SERIALIZE = (value: unknown): string => JSON.stringify(value);
const JSON_DESERIALIZE = <T,>(raw: string): T => JSON.parse(raw) as T;

interface UsePersistedStateOptions<T> {
  /** 序列化：默认 JSON.stringify */
  serialize?: Serialize<T>;
  /** 反序列化：默认 JSON.parse（解析失败回退默认值） */
  deserialize?: Deserialize<T>;
}

/**
 * 与持久化存储同步的 state。
 *
 * @param key - 存储键
 * @param defaultValue - 未命中或读取失败时的默认值
 * @param options - 可选自定义序列化/反序列化（用于非 JSON 存储格式）
 * @returns [value, setValue]，setValue 与 useState 的 setter 同型
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: UsePersistedStateOptions<T>,
) {
  // serialize/deserialize 经 ref 持有最新引用，effect 依赖不随调用方内联函数变化
  const serializeRef = useRef<Serialize<T>>(options?.serialize ?? JSON_SERIALIZE);
  const deserializeRef = useRef<Deserialize<T>>(options?.deserialize ?? JSON_DESERIALIZE);
  serializeRef.current = options?.serialize ?? JSON_SERIALIZE;
  deserializeRef.current = options?.deserialize ?? JSON_DESERIALIZE;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      return deserializeRef.current(raw);
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, serializeRef.current(value));
    } catch { /* ignore */ }
  }, [key, value]);

  return [value, setValue] as const;
}
