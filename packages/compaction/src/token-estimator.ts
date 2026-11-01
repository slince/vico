// @vico/compaction - Token 估算：分 part 定价 + ROLE/BLOCK 开销 + 消息链自带 usage 锚定
import type {ModelMessage} from 'ai';
import type {AgentMessage} from '@vico/thread';
import {getMessageText} from '@vico/model';

/** 每 token 对应字符数（固定启发式） */
export const CHARS_PER_TOKEN = 4;
/** 每个 content block 的 JSON 结构/类型标签开销 */
export const BLOCK_OVERHEAD = 4;
/** 每条消息 role 字段框架开销 */
export const ROLE_OVERHEAD = 4;

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

/** 批量启发式估算：逐消息求和（不含 usage 锚定） */
export function estimateMessages(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessage(m), 0);
}

/**
 * 测量当前上下文的 token 占用：从尾部找最近一条携带 usage 的消息，以其 input token
 * 为基线，加上该消息之后其它消息的启发式估算；无可用 usage 时退化为全量启发式估算。
 *
 * usage 是消息自带的 in-band 元数据（assistant 消息经 persistMessages 挂载），
 * 其 input token 已覆盖该消息之前的完整上下文，故只需补算其后的增量。
 */
export function measure(messages: AgentMessage[]): number {
  let trailing = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const inputTokens = msg.usage?.inputTokens.total;
    if (inputTokens !== undefined) {
      // input token 覆盖 [0..i]，其后的消息已累计在 trailing
      return inputTokens + trailing;
    }
    // 非锚定消息（含其之前）都需启发式估算
    trailing += estimateMessage(msg);
  }
  // 无任何带 usage 的消息 → trailing 已累计全部消息的启发式估算
  return trailing;
}
