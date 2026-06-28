// src/tool/builtin/delegate-tool.ts
import { z } from 'zod';
import { createTool } from '../../create-tool.js';
import { createAgent, type AgentConfig } from '../../../agent-loop/create-agent.js';
import type { ToolExecutionContext } from '../../types.js';

const delegateParams = z.object({
  task: z.string().describe('要委托给子 agent 完成的任务描述'),
  context: z.string().optional().describe('传递给子 agent 的上下文信息'),
});

const delegateOutput = z.object({
  result: z.string(),
  steps: z.number().int().optional(),
  error: z.string().optional(),
});

/**
 * 创建委托工具。
 *
 * 子 agent 使用独立的 AgentLoop 执行子任务，
 * 继承父 agent 的 model 配置但使用受限的工具集。
 */
export function createDelegateTool(parentConfig: {
  getConfig(): AgentConfig;
}) {
  async function execute(args: z.infer<typeof delegateParams>, ctx: ToolExecutionContext) {
    const parent = parentConfig.getConfig();

    // 子 agent 配置：继承 model，仅使用只读工具 + todo
    const childConfig: AgentConfig = {
      id: `${parent.id}-delegate-${Date.now()}`,
      name: `${parent.name}-delegate`,
      systemPrompt: [
        '你是一个子任务执行 agent。完成分配给你的特定任务，然后返回结果。',
        '只使用只读工具查看代码和文件，不要修改任何文件。',
        '完成后，总结你的发现。',
      ].join('\n'),
      model: parent.model,
      temperature: parent.temperature ?? 0.3,
      maxTokens: parent.maxTokens ?? 4096,
      maxSteps: 5,
      workspace: parent.workspace,
      tools: [],
      skills: parent.skills,
      memory: parent.memory,
      thread: parent.thread,
    };

    const childAgent = createAgent(childConfig);

    const message = [
      `## 子任务`,
      args.task,
      args.context ? `\n## 上下文\n${args.context}` : '',
      '\n请完成上述任务，总结你的发现。',
    ].join('\n');

    try {
      const result = await childAgent.invoke(message, {
        threadId: ctx.session.thread.id,
        userId: 'delegate',
        scopeId: ctx.session.thread.id,
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
      '将子任务委托给子 agent 执行。子 agent 使用只读工具探索代码库并返回分析结果。适用于大规模代码搜索、多文件分析等需要独立上下文的场景。',
    inputSchema: delegateParams,
    outputSchema: delegateOutput,
    policy: 'auto',
    kind: 'delegate',
    tags: ['builtin', 'delegate'],
    execute,
  });
}
