// @vico/agent - delegate 工具的提示词与文案（LLM 面向，统一英文）

/** 子 agent 系统提示词：只读探索代码库并返回分析结果 */
export const DELEGATE_SYSTEM_PROMPT = `You are a subtask execution agent. Complete the specific task assigned to you and return the result.
Use only read-only tools to inspect code and files; do not modify any files.
Summarize your findings when finished.`;

/**
 * 构造子 agent 的用户消息：任务 + 可选上下文。
 *
 * @param task - 委托给子 agent 的任务描述
 * @param context - 可选的上下文信息
 * @returns 子 agent 的用户消息文本
 */
export function buildDelegateMessage(task: string, context?: string): string {
  return `<task>
${task}
</task>

<context>
${context ?? 'No other information.'}
</context>

Complete the task above and summarize your findings.`;
}
