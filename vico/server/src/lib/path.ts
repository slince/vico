/**
 * 路径工具 — 与配置文件无关的通用路径处理。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 展开路径开头的 `~` 为用户主目录。
 *
 * YAML 配置里的 `~/xxx` 不会被 Node 自动展开，读配置后需在消费点调用本函数。
 *
 * @param p 原始路径
 * @returns 展开后的绝对路径；不以 `~` 开头时原样返回
 */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}
