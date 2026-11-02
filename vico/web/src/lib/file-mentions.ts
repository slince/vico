/**
 * 文件提及词汇表 — 从 assistant 消息的工具调用里收集真实文件路径，
 * 并对 markdown 行内代码 token 做精确 / 唯一 basename 匹配。
 *
 * 原则对齐 DeepSeek Harness：渲染器从不猜「什么像路径」，只认
 * 「本消息里真实 read / write / edit / glob 过的文件」。这样标题里提到的
 * 裸文件名（如 `model-client.ts`）只要没有对应的工具产出记录，就不会被
 * 渲染成可点击链接。
 */
import { basename } from './file-link';

/** 工具调用 part 的最小结构（只读取判定所需的字段） */
interface ToolCallPartLike {
  type?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/**
 * 从一条 assistant 消息里收集真实文件路径。
 *
 * read / write / edit 取 `path`（结果优先，参数兜底），glob 取 `files` 列表；
 * grep（匹配文本）、bash（stdout 文本）等不做文本解析，保持「不猜文本」。
 *
 * @param message - 当前 assistant 消息（可为空，宽松类型以兼容 assistant-ui 的 message scope）
 * @returns 去重后的真实文件路径，按首次出现顺序
 */
export function collectFilePaths(message: unknown): string[] {
  const content = (message as { content?: readonly unknown[] } | null | undefined)?.content;
  const paths = new Set<string>();
  for (const raw of content ?? []) {
    const part = raw as ToolCallPartLike;
    if (part.type !== 'tool-call') continue;
    switch (part.toolName) {
      case 'read':
      case 'write':
      case 'edit': {
        const path = part.result?.path ?? part.args?.path;
        if (typeof path === 'string' && path.trim() !== '') paths.add(path);
        break;
      }
      case 'glob': {
        const files = part.result?.files;
        if (Array.isArray(files)) {
          for (const f of files) {
            if (typeof f === 'string' && f !== '') paths.add(f);
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return [...paths];
}

/**
 * 把一个行内代码 token 匹配到真实文件路径。
 *
 * - 精确路径命中 → 返回该路径
 * - 否则仅当 token 是「唯一一个」路径的 basename 时命中 → 返回该完整路径
 * - 歧义（多个同名文件）或未知 token → 返回 undefined（保持普通代码）
 *
 * @param paths - 本消息的真实文件路径
 * @param value - markdown 行内代码原文
 * @returns 命中的完整路径，未命中返回 undefined
 */
export function resolveFileMention(
  paths: readonly string[],
  value: string,
): string | undefined {
  if (paths.includes(value)) return value;
  const matches = paths.filter((p) => basename(p) === value);
  return matches.length === 1 ? matches[0] : undefined;
}
