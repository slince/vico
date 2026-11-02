/**
 * 文件路径工具 — 文件引用链接的通用辅助。
 *
 * 不再做「像不像路径」的启发式判定（已迁移到 lib/file-mentions.ts 的真实
 * 文件词汇表匹配），此处只保留链接协议判定与 basename 提取。
 */

/**
 * 判定一个 markdown 链接 href 是否应进入文件引用匹配流程。
 *
 * 排除外部协议与页内锚点；其余（相对/绝对文件路径）交给文件词汇表精确匹配。
 *
 * @param href - markdown 链接目标
 * @returns 是否可能是文件链接
 */
export function isFileLinkHref(href: string): boolean {
  return !/^(https?:|mailto:|tel:|blob:|data:|javascript:|#)/i.test(href);
}

/**
 * 提取路径的最后一段（文件名）。
 *
 * 兼容 `/` 与 `\` 两种分隔符；空串时原样返回。
 *
 * @param path - 完整路径
 * @returns 路径末段
 */
export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
