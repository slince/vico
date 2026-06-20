// @vico/agent - PromptAssembler port interface: assembles system prompt from context
import type { PromptAssembler, PromptContext } from './types.js';
import type { ModelRequest, ModelMessage } from '../model/model-client.js';

export type { SkillCatalogEntry, RagChunk, PromptContext, PromptAssembler } from './types.js';

/**
 * PromptAssembler 默认实现。
 *
 * 拼装顺序针对 Prompt 缓存进行了优化：
 * 1. System prompt + Skill 目录（不可变前缀，可被 LLM 缓存复用）
 * 2. 对话历史
 * 3. 动态上下文（记忆、RAG、动态指令）—— 放在 history 之后，避免破坏缓存前缀
 */
export class PromptAssemblerImpl implements PromptAssembler {
  assemble(context: PromptContext): ModelRequest {
    const messages: ModelMessage[] = [];
    const { agent, skillCatalog, memoryItems, ragResults, history, tools, dynamicInstructions } =
      context;

    // 1. 系统提示词（不可变前缀，可被 Prompt 缓存复用）
    let systemPrompt = agent.systemPrompt;

    // 2. Skill 目录 — 折叠进 system prompt 以利用缓存
    if (skillCatalog.length > 0) {
      const skillList = skillCatalog
        .map((s) => `- ${s.name}: ${s.description}`)
        .join('\n');
      systemPrompt += `\n\n<available_skills>\n${skillList}\n</available_skills>`;
    }

    // 3. 对话历史
    messages.push(...history);

    // 4. 动态上下文指令（放在 history 之后，避免破坏缓存前缀）
    if (memoryItems.length > 0) {
      const memText = memoryItems.map((m) => `- ${m.content}`).join('\n');
      messages.push({ role: 'system', content: `Relevant memories:\n${memText}` });
    }

    if (ragResults.length > 0) {
      const ragText = ragResults.map((r) => `[${r.source}] ${r.content}`).join('\n');
      messages.push({ role: 'system', content: `Relevant knowledge:\n${ragText}` });
    }

    if (dynamicInstructions.length > 0) {
      messages.push({ role: 'system', content: dynamicInstructions.join('\n') });
    }

    return {
      system: systemPrompt,
      messages,
      tools,
      maxTokens: agent.maxTokens,
      temperature: agent.temperature,
      abortSignal: new AbortController().signal, // caller overrides
    };
  }
}
