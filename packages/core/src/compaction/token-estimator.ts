// @vico/core - Token 估算：分 part 定价 + ROLE/BLOCK 开销 + usage 锚定（对齐 deepseek dsh-token-meter）
import type {ModelMessage} from 'ai';
import {getMessageText} from '../model/message-utils.js';

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

/** 单条消息的双级价格 */
export interface PricedMessage {
  message: ModelMessage;
  /** route-priced 价格（判定/切分/shrink 用；v1 纯文本 === heuristic） */
  tokens: number;
  /** 固定启发式价格（替换记账 shadow-price 用） */
  heuristicTokens: number;
}

/** 测量结果 */
export interface TokenMeasurement {
  /** usage 锚定后的投影 token；无 anchor 时 = surfaceTokens */
  totalTokens: number;
  /** Σ route-priced token */
  surfaceTokens: number;
  /** Σ heuristic token */
  heuristicTokens: number;
  nodes: PricedMessage[];
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

/** 批量测量：v1 无图片/文件，route 价格 = heuristic；有 anchor 时做 usage 投影 */
export function measure(messages: ModelMessage[], anchor?: TokenAnchor): TokenMeasurement {
  const nodes: PricedMessage[] = messages.map((message) => {
    const heuristicTokens = estimateMessage(message);
    return { message, tokens: heuristicTokens, heuristicTokens };
  });
  const surfaceTokens = nodes.reduce((s, n) => s + n.tokens, 0);
  const heuristicTokens = nodes.reduce((s, n) => s + n.heuristicTokens, 0);
  const totalTokens = anchor
    ? Math.max(0, anchor.pressureTokens + surfaceTokens - anchor.sampledSurfaceTokens)
    : surfaceTokens;
  return { totalTokens, surfaceTokens, heuristicTokens, nodes };
}
