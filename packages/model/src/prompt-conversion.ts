// @vico/model - ModelMessage → LanguageModelV4Prompt 转换 + 工具预处理
//
// 原依赖 ai/internal 的 standardizePrompt / convertToLanguageModelPrompt / prepareTools。
// 为彻底移除 ai 包，此处本地重实现 Vico 实际用到的子集（文本 / 推理 / 工具调用 / 工具结果 /
// 审批标记），保持与 AI SDK 相同的语义：assistant 的 tool-approval-request 剥离、
// tool 消息的非 providerExecuted tool-approval-response 剥离、连续 tool 消息合并、空 tool 消息剔除。
import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider';
import {asSchema, type ModelMessage, type ToolSet} from '@ai-sdk/provider-utils';

/** standardizePrompt 的产出：messages + 合并后的系统指令 */
export interface StandardizedPrompt {
  messages: ModelMessage[];
  instructions?: string;
}

/** ModelMessage 的 content part 联合类型（去除 string 后的数组元素） */
type ModelContentPart = Exclude<ModelMessage['content'], string>[number];

/**
 * 校验并标准化消息（system 合并进 instructions）。
 * Vico 场景下 system 为字符串指令、messages 为原生 ModelMessage 组，
 * 仅做透传标准化，不做 ai 包的完整 schema 校验。
 *
 * @param opts.system - 系统提示词
 * @param opts.messages - 原生消息列表
 */
export async function standardizePrompt(opts: {
  system?: string;
  messages: ModelMessage[];
}): Promise<StandardizedPrompt> {
  return { messages: opts.messages, instructions: opts.system };
}

/** 单条 ModelMessage → provider 消息 */
function convertToLanguageModelMessage(message: ModelMessage): LanguageModelV4Message {
  const providerOptions = message.providerOptions as SharedV4ProviderOptions | undefined;
  const opts = providerOptions != null ? { providerOptions } : {};

  switch (message.role) {
    case 'system':
      return { role: 'system', content: typeof message.content === 'string' ? message.content : '', ...opts };

    case 'user': {
      if (typeof message.content === 'string') {
        return { role: 'user', content: [{ type: 'text', text: message.content }], ...opts } as LanguageModelV4Message;
      }
      const content = message.content
        .map((part) => (part.type === 'text' ? { type: 'text' as const, text: part.text, ...(part.providerOptions != null ? { providerOptions: part.providerOptions } : {}) } : part))
        .filter((part) => part.type !== 'text' || (part as { text?: string }).text !== '');
      return { role: 'user', content, ...opts } as LanguageModelV4Message;
    }

    case 'assistant': {
      if (typeof message.content === 'string') {
        return { role: 'assistant', content: [{ type: 'text', text: message.content }], ...opts } as LanguageModelV4Message;
      }
      const content = message.content
        .filter((part) => part.type !== 'tool-approval-request')
        .filter((part) => part.type !== 'text' || part.text !== '' || part.providerOptions != null)
        .map((part) => convertAssistantPart(part));
      return { role: 'assistant', content, ...opts } as LanguageModelV4Message;
    }

    case 'tool': {
      const content = message.content
        .filter((part) => part.type !== 'tool-approval-response' || part.providerExecuted)
        .map((part) => convertToolPart(part));
      return { role: 'tool', content, ...opts } as LanguageModelV4Message;
    }

    default:
      throw new Error(`Invalid message role: ${String((message as { role: string }).role)}`);
  }
}

/** assistant 消息 part → provider part */
function convertAssistantPart(part: ModelContentPart) {
  switch (part.type) {
    case 'text':
      return { type: 'text' as const, text: part.text, ...(part.providerOptions != null ? { providerOptions: part.providerOptions } : {}) };
    case 'reasoning':
      return { type: 'reasoning' as const, text: part.text, ...(part.providerOptions != null ? { providerOptions: part.providerOptions } : {}) };
    case 'tool-call':
      return {
        type: 'tool-call' as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        ...(part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {}),
        ...(part.providerOptions != null ? { providerOptions: part.providerOptions } : {}),
      };
    case 'tool-result':
      return {
        type: 'tool-result' as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: part.output,
        ...(part.providerOptions != null ? { providerOptions: part.providerOptions } : {}),
      };
    default:
      // file / reasoning-file / custom 等原样透传
      return part;
  }
}

/** tool 消息 part → provider part */
function convertToolPart(part: ModelContentPart) {
  switch (part.type) {
    case 'tool-result':
      return {
        type: 'tool-result' as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: part.output,
        ...(part.providerOptions != null ? { providerOptions: part.providerOptions } : {}),
      };
    case 'tool-approval-response':
      return {
        type: 'tool-approval-response' as const,
        approvalId: part.approvalId,
        approved: part.approved,
        ...(part.reason != null ? { reason: part.reason } : {}),
      };
    default:
      return part;
  }
}

/**
 * 原生 ModelMessage → LanguageModelV4Prompt。
 * 合并 instructions 为 system 消息；连续 tool 消息合并；空 tool 消息剔除。
 *
 * @param opts.prompt - standardizePrompt 的产出
 */
export async function convertToLanguageModelPrompt(opts: {
  prompt: StandardizedPrompt;
  supportedUrls?: unknown;
  download?: undefined;
}): Promise<LanguageModelV4Prompt> {
  const { prompt } = opts;
  const messages: LanguageModelV4Message[] = [];

  if (prompt.instructions != null) {
    messages.push({ role: 'system', content: prompt.instructions });
  }
  for (const message of prompt.messages) {
    messages.push(convertToLanguageModelMessage(message));
  }

  // 连续 tool 消息合并为一条（provider 兼容）
  const combined: LanguageModelV4Message[] = [];
  for (const message of messages) {
    if (message.role !== 'tool') {
      combined.push(message);
      continue;
    }
    const last = combined[combined.length - 1];
    if (last?.role === 'tool') {
      (last.content as unknown[]).push(...(message.content as unknown[]));
    } else {
      combined.push(message);
    }
  }

  // 空 tool 消息剔除
  return combined.filter((m) => m.role !== 'tool' || (m.content as unknown[]).length > 0);
}

/**
 * Vico ToolSet → provider 工具格式（原 ai prepareTools 的 function 子集）。
 *
 * @param tools - toToolSet 产出的 ToolSet
 */
export async function prepareTools(tools: ToolSet): Promise<LanguageModelV4FunctionTool[] | undefined> {
  const entries = Object.entries(tools);
  if (entries.length === 0) return undefined;

  const languageModelTools: LanguageModelV4FunctionTool[] = [];
  for (const [name, tool] of entries) {
    if (tool.type != null && tool.type !== 'dynamic' && tool.type !== 'function') {
      throw new Error(`Unsupported tool type: ${String(tool.type)}`);
    }
    const description = typeof tool.description === 'string' ? tool.description : undefined;
    languageModelTools.push({
      type: 'function',
      name,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
      ...(description != null ? { description } : {}),
    });
  }
  return languageModelTools;
}
