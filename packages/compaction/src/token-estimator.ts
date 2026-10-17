// @vico/core - Token 估算：分 part 定价 + ROLE/BLOCK 开销 + usage 锚定（对齐 deepseek dsh-token-meter）
import type {ModelMessage} from 'ai';
import {getMessageText} from '@vico/model';

/** 每 token 对应字符数（固定启发式） */
export const CHARS_PER_TOKEN = 4;
/** 每个 content block 的 JSON 结构/类型标签开销 */
export const BLOCK_OVERHEAD = 4;
/** 每条消息 role 字段框架开销 */
export const ROLE_OVERHEAD = 4;

/** usage 锚定输入：最近 provider 上报 prompt token 与采样时 surface 快照 */
export interface TokenAnchor {
  pressureTokens: number;
  sampledSurfaceTokens: number;
}

/** 测量结果 */
export interface TokenMeasurement {
  /** usage 锚定后的投影 token；无 anchor 时 = surfaceTokens */
  totalTokens: number;
  /** Σ 启发式估算 token */
  surfaceTokens: number;
}

/**
 * 估算 content（string 或 parts 数组）的 token 数。
 * text/reasoning → 文本密度 + block 开销；tool-call → 名 + 参数 + block 开销；其它 → JSON 密度 + block 开销。
 */
export function estimateContent(content: ModelMessage['content']): number {
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
  }
  let total = 0;
  for (const block of content) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        total += Math.ceil(((block as { text?: string }).text?.length ?? 0) / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case 'tool-call': {
        const tc = block as { toolName?: string; input?: unknown };
        total += Math.ceil((tc.toolName?.length ?? 0) / CHARS_PER_TOKEN)
          + Math.ceil(JSON.stringify(tc.input ?? {}).length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD;
        break;
      }
      default:
        total += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return total;
}

/** system 消息按纯文本密度 + ROLE_OVERHEAD 估（无 per-block 开销，对齐 deepseek estimateSystemMessage） */
function estimateSystemMessage(msg: ModelMessage): number {
  return Math.ceil(getMessageText(msg).length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}

/** 单条消息估算：system 特殊处理，其它 content + ROLE_OVERHEAD */
export function estimateMessage(msg: ModelMessage): number {
  if (msg.role === 'system') return estimateSystemMessage(msg);
  return estimateContent(msg.content) + ROLE_OVERHEAD;
}

/**
 * 批量测量：逐消息启发式估算后累加，有 anchor 时做 usage 投影。
 * 注意：anchor.pressureTokens 是 provider 上报的完整请求 input token（含 system prompt / 历史 / 工具定义），
 * 与 surfaceTokens（仅窗口内消息 + 摘要的启发式价格）口径不同，投影是近似校准而非精确换算。
 */
export function measure(messages: ModelMessage[], anchor?: TokenAnchor): TokenMeasurement {
  const surfaceTokens = messages.reduce((sum, m) => sum + estimateMessage(m), 0);
  const totalTokens = anchor
    ? Math.max(0, anchor.pressureTokens + surfaceTokens - anchor.sampledSurfaceTokens)
    : surfaceTokens;
  return { totalTokens, surfaceTokens };
}
