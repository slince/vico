// src/tool/builtin/delegate-tool.ts
import {z} from 'zod';
import {createTool} from '@vico/tool';
import {type AgentConfig, createAgent} from '../create-agent.js';
import type {ToolCallContext} from '@vico/tool';
import {DELEGATE_SYSTEM_PROMPT, buildDelegateMessage} from './delegate-prompts.js';

const delegateParams = z.object({
  task: z.string().describe('The task to delegate to the child agent'),
  context: z.string().optional().describe('Optional context to pass to the child agent'),
});

const delegateOutput = z.object({
  result: z.string(),
  steps: z.number().int().optional(),
  error: z.string().optional(),
});

/**
 * 创建委托工具。
 *
 * 子 agent 使用独立的 LoopAgent 执行子任务，
 * 继承父 agent 的 model 配置但使用受限的工具集。
 */
export function createDelegateTool(parentConfig: { getConfig(): AgentConfig}) {
  async function execute(args: z.infer<typeof delegateParams>, ctx: ToolCallContext) {
    const parent = parentConfig.getConfig();

    // 子 agent 配置：继承 model，仅使用只读工具 + todo
    const childConfig: AgentConfig = {
      id: `${parent.id}-delegate-${Date.now()}`,
      name: `${parent.name}-delegate`,
      systemPrompt: DELEGATE_SYSTEM_PROMPT,
      model: parent.model,
      temperature: parent.temperature ?? 0.3,
      maxSteps: 5,
      workspace: parent.workspace,
      tools: [],
      skills: parent.skills,
      memory: parent.memory,
      thread: parent.thread,
    };

    const childAgent = await createAgent(childConfig);

    const message = buildDelegateMessage(args.task, args.context);

    try {
      const result = await childAgent.invoke(message, {
        thread: ctx.session.thread,
      });

      const text = result.messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n');

      return { result: text, steps: result.steps };
    } catch (err: any) {
      return { result: '', error: err.message };
    }
  }

  return createTool({
    name: 'delegate',
    description:
      'Delegate a subtask to a child agent. The child agent explores the codebase with read-only tools and returns an analysis. Useful for large-scale code search, multi-file analysis, and other scenarios that need an isolated context.',
    inputSchema: delegateParams,
    outputSchema: delegateOutput,
    policy: 'auto',
    kind: 'readonly',
    execute,
  });
}
