/** 将知识库 UUID 转换为合法的 LibSQLVector 索引名（替换连字符为下划线） */
export function kbIndexName(kbId: string): string {
  return `kb_${kbId.replace(/-/g, '_')}`;
}
