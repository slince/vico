/**
 * 合并多个 Map，后面的 Map 覆盖前面的同名键。
 *
 * @param maps 需要合并的 Map 列表
 * @returns 合并后的新 Map
 */
export function mergeMaps<K, V>(...maps: Map<K, V>[]): Map<K, V> {
  const res = new Map<K, V>();
  for (const m of maps) {
    for (const [k, v] of m) {
      res.set(k, v);
    }
  }
  return res;
}
