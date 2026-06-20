// @vico/agent - PromptAssembler port interface: assembles system prompt from context
import type { AgentConfig } from '../contracts/agent.js';
import type { ModelRequest, ModelMessage } from '../model/model-client.js';
import type { ToolSpec } from '../contracts/tool.js';
import type { MemoryRecord } from '../contracts/memory.js';

/** Skill 目录项（元数据，非完整指令） */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
}

/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

/** Prompt 拼装上下文 */
export interface PromptContext {
  agent: AgentConfig;
  skillCatalog: SkillCatalogEntry[];
  memoryItems: MemoryRecord[];
  ragResults: RagChunk[];
  history: ModelMessage[];
  tools: ToolSpec[];
  dynamicInstructions: string[];
}

/** 系统提示词拼装器端口 */
export interface PromptAssembler {
  assemble(context: PromptContext): ModelRequest;
}

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
