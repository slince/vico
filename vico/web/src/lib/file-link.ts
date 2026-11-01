/**
 * 文件路径判定工具 — 识别 LLM 输出中的文件引用。
 *
 * 前端把「像文件路径」的文本渲染成可点击链接，点击后打开右侧文件预览面板。
 * 判定采用启发式：路径分隔符、显式相对/绝对前缀，或已知扩展名结尾的文件名。
 */

/** 常见文件扩展名集合 — 用于识别不带目录分隔符的裸文件名（如 `index.ts`） */
const KNOWN_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'json', 'md', 'mdx', 'txt', 'css', 'scss', 'less',
  'html', 'htm', 'vue', 'svelte', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'swift', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'php',
  'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'gql',
  'prisma', 'env', 'gitignore', 'lock', 'csv', 'svg', 'png', 'jpg', 'jpeg',
  'gif', 'webp', 'ico', 'pdf', 'wasm', 'proto', 'nix', 'nix', 'tf',
]);

/** 路径最大长度 — 超长文本（如命令/代码片段）不视为文件路径 */
const MAX_PATH_LENGTH = 512;

/**
 * 判定一个字符串是否「像文件路径」。
 *
 * 规则（满足其一即命中）：
 * - 以 `./`、`../`、`/`、`~` 开头（显式相对/绝对/家目录路径）
 * - 含 `/` 或 `\` 分隔符
 * - 无空白、以已知扩展名结尾的裸文件名（如 `index.ts`）
 *
 * @param value - 待判定文本
 * @returns 是否可视为文件路径
 */
export function isFilePathCandidate(value: string): boolean {
  if (!value) return false;
  const s = value.trim();
  if (s.length === 0 || s.length > MAX_PATH_LENGTH) return false;

  // 显式相对路径 / 绝对路径 / 家目录
  if (/^(\.{1,2}[\\/])|^[\\/]|^~[\\/]/.test(s)) return true;

  // 含路径分隔符（覆盖 `src/index.ts`、`a/b` 等）
  if (/[\\/]/.test(s)) return true;

  // 裸文件名：无空白且以已知扩展名结尾
  if (!/\s/.test(s)) {
    const dot = s.lastIndexOf('.');
    if (dot > 0 && dot < s.length - 1) {
      const ext = s.slice(dot + 1).toLowerCase();
      if (KNOWN_EXTENSIONS.has(ext)) return true;
    }
  }

  return false;
}

/**
 * 判定一个 markdown 链接 href 是否应作为文件链接处理。
 *
 * 排除外部协议与页内锚点，其余交给 {@link isFilePathCandidate} 判定。
 *
 * @param href - markdown 链接目标
 * @returns 是否为文件链接
 */
export function isFileLinkHref(href: string): boolean {
  if (/^(https?:|mailto:|tel:|blob:|data:|javascript:|#)/i.test(href)) return false;
  return isFilePathCandidate(href);
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
