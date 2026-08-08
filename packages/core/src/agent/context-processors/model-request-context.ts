// @vico/core - ModelRequestContext: 穿过洋葱层各处理器的可变上下文
import type {ModelMessage} from 'ai';
import {getMessageText, pickPrimaryUserMessage} from '../../model/message-utils.js';
import type {Tool} from '../../tool/types.js';
import type {Thread} from '../../thread/thread-store.js';
import {Step, TurnSession} from "../agent-loop-options.js";

/** 上下文中的 Agent 引用 — 提供处理器所需的配置字段 */
export interface AgentRef {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
}

/** 穿过洋葱各层的可变上下文 */
export class ModelRequestContext {
  /** Agent 配置（只读引用） */
  readonly agent: AgentRef;
  /** 系统提示词 — 处理器追加内容 */
  systemPrompt: string;
  /** 本轮输入消息组 */
  readonly userMessages: ModelMessage[];
  /** 消息列表 — 处理器可追加 history（unshift）和 system/memory 消息（push） */
  messages: ModelMessage[];
  /** 暴露给 LLM 的工具 */
  tools: Tool[];
  /** 当前 turn 会话（身份 + 线程引用） */
  readonly session?: TurnSession;
  /** 当前 step（一次 LLM 调用 + 可选工具执行） */
  step?: Step;

  constructor({
    agent,
    userMessages,
    messages,
    systemPrompt,
    tools,
    session,
    step,
  }: {
    agent: AgentRef;
    userMessages?: ModelMessage[];
    messages?: ModelMessage[];
    systemPrompt?: string;
    tools?: Tool[];
    session?: TurnSession;
    step?: Step;
  }) {
    this.agent = agent;
    this.userMessages = userMessages ?? [];
    this.messages = messages ? [...messages, ...this.userMessages] : [...this.userMessages];
    this.systemPrompt = systemPrompt ?? '';
    this.tools = tools ?? [];
    this.session = session;
    this.step = step;
  }

  /** 主用户消息（本轮消息组中末条 user 角色；未提供消息组时从 messages 兜底查找） */
  get userMessage(): ModelMessage {
    return pickPrimaryUserMessage(this.userMessages) ?? this.messages.find(m => m.role === 'user')!;
  }

  /** 便捷获取当前线程 */
  get thread(): Thread | undefined {
    return this.session?.thread;
  }

  /**
   * 便捷获取 threadId。
   *
   * @returns 线程 ID，无线程时返回空字符串
   */
  get threadId(): string {
    return this.session?.thread.id ?? '';
  }

  /** 便捷获取工作记忆作用域标识 */
  get scopeId(): string {
    return this.session?.thread.id ?? '';
  }

  /**
   * 获取最后一条用户消息的纯文本内容。
   */
  getLastUserMessage(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'user') return getMessageText(msg);
    }
    return '';
  }
}
