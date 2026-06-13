/**
 * Agent Team Orchestrator — 多 Agent 协作编排引擎
 *
 * 使用 supervisor + delegation 模式实现多 Agent 协作。
 * Supervisor Agent 获得 delegate_to_<agentId> 工具，可委派子任务给团队成员。
 * 子 Agent 在进程内执行 streamText，收集文本结果后返回给 Supervisor 进行综合回复。
 *
 * SSE 事件类型：
 * - text_delta:   { type, content }
 * - delegation_end: { type, agentId, agentName, summary }
 * - done:         { type }
 * - error:        { type, message }
 */
import { tool, streamText } from 'ai';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../db/db.js';
import { config } from '../config.js';
import { resolveAgentModel } from './mastra/bridges/model-bridge.js';
import { getSkillToolsForMastraAgent, getSkillPromptForAgent } from './mastra/bridges/skill-bridge.js';
import { createRagTool, getRagContext } from './mastra/bridges/rag-bridge.js';
import { shortTermMemory } from '../memory/short-term.js';
import { longTermMemory } from '../memory/long-term.js';
import type { PipelineContext } from './pipeline.js';

const { agentTeams, agentTeamMembers, agents, conversations, messages } = schema;

/**
 * 执行子 Agent 并收集其完整文本响应。
 * 复用与单 Agent 管道相同的模型/Skills/RAG Bridge 层。
 *
 * @param agentId - 目标子 Agent 的 ID
 * @param task - 委派给子 Agent 的具体任务描述
 * @param ctx - 管道上下文（租户、用户等）
 * @returns 子 Agent 的完整文本响应，失败时返回错误信息字符串
 */
async function delegateToAgent(
  agentId: string,
  task: string,
  ctx: PipelineContext,
): Promise<string> {
  const db = getDb();

  // 加载子 Agent 配置
  const agentRow = db.select().from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agentRow) return `[Error: Agent ${agentId} not found]`;

  // 解析模型
  const { model } = resolveAgentModel(ctx.tenantId, agentRow.model_id);

  // 构建系统提示词：Agent prompt + Skill prompt + 长期记忆 + RAG
  const skillPrompt = getSkillPromptForAgent(agentId);
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, task, 3);
  const ltmContext = ltmFacts.length > 0
    ? '\n\n## 长期记忆\n' + ltmFacts.map((f: { content: string }) => `- ${f.content}`).join('\n')
    : '';
  const ragContext = await getRagContext(agentId, task);
  const systemPrompt = [
    agentRow.system_prompt,
    skillPrompt,
    ltmContext,
    ragContext,
  ].filter(Boolean).join('\n');

  // 构建子 Agent 的工具集（Skill tools + RAG tool）
  const skillTools = getSkillToolsForMastraAgent(agentId, {
    tenantId: ctx.tenantId,
    agentId,
    userId: ctx.userId,
  });
  const ragTool = createRagTool(agentId);

  const aiTools: Record<string, any> = {};
  for (const [name, t] of Object.entries(skillTools)) {
    aiTools[name] = tool({
      description: t.description,
      parameters: t.inputSchema,
      execute: async (args: any) => {
        const result = await t.execute({ context: { args } });
        return result;
      },
    });
  }
  if (ragTool) {
    aiTools[ragTool.id] = tool({
      description: ragTool.description,
      parameters: ragTool.inputSchema,
      execute: async (args: any) => {
        const result = await ragTool.execute({ context: { args } });
        return result;
      },
    });
  }

  // 执行 streamText 并收集完整文本
  try {
    const result = streamText({
      model: model as any,
      system: systemPrompt,
      messages: [{ role: 'user', content: task }],
      tools: aiTools,
      maxSteps: 5,
      temperature: agentRow.temperature ?? 0.7,
      maxTokens: agentRow.max_tokens ?? 4096,
    });
    return (await result.text) || '';
  } catch (err: any) {
    return `[Error delegating to ${agentRow.name}: ${err.message}]`;
  }
}

/**
 * 为每个团队成员构建委派工具。
 * 每个工具命名为 delegate_to_<agentId>，接受一个 task 参数。
 *
 * @param members - 团队成员列表
 * @param ctx - 管道上下文
 * @returns AI SDK v4 格式的工具映射表
 */
function buildDelegationTools(
  members: { agent_id: string; agent_name: string; role: string }[],
  ctx: PipelineContext,
): Record<string, any> {
  const tools: Record<string, any> = {};

  for (const member of members) {
    const toolName = `delegate_to_${member.agent_id}`;
    tools[toolName] = tool({
      description: `将任务委派给「${member.agent_name}」（角色：${member.role || '成员'}）。传递清晰的任务描述，该 Agent 将独立完成并返回结果。`,
      parameters: z.object({
        task: z.string().describe(`委派给 ${member.agent_name} 的具体任务`),
      }),
      execute: async (args: any) => {
        const taskDescription = args?.task || '';
        return delegateToAgent(member.agent_id, taskDescription, ctx);
      },
    });
  }

  return tools;
}

/**
 * 执行团队聊天管道。
 *
 * 加载团队配置 → 确定 Supervisor Agent → 构建 system prompt（含成员描述和协调规则）
 * → 注册委派工具 + Skill 工具 + RAG 工具 → 执行 streamText → SSE 响应
 *
 * @param teamId - 团队 ID
 * @param message - 用户消息
 * @param ctx - 管道上下文
 * @returns SSE 流和元数据
 */
export async function runTeamPipeline(
  teamId: string,
  message: string,
  ctx: PipelineContext,
): Promise<{ stream: ReadableStream; metadata: { conversationId: string; teamId: string } }> {
  const db = getDb();

  // 1. 加载团队配置
  const team = db.select().from(agentTeams)
    .where(and(eq(agentTeams.id, teamId), eq(agentTeams.tenant_id, ctx.tenantId)))
    .get();
  if (!team) throw new Error('Team not found');

  const memberRows = db.select({
    agent_id: agentTeamMembers.agent_id,
    role: agentTeamMembers.role,
    agent_name: agents.name,
  })
    .from(agentTeamMembers)
    .leftJoin(agents, eq(agentTeamMembers.agent_id, agents.id))
    .where(eq(agentTeamMembers.team_id, teamId))
    .all();

  if (memberRows.length === 0) throw new Error('Team has no members');

  const members = memberRows.map((r) => ({
    agent_id: r.agent_id,
    agent_name: r.agent_name || r.agent_id,
    role: r.role,
  }));

  // 2. 确定 Supervisor Agent（默认为第一个成员）
  const supervisorId = team.supervisor_agent_id || members[0].agent_id;
  const supervisorRow = db.select().from(agents)
    .where(and(eq(agents.id, supervisorId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!supervisorRow) throw new Error('Supervisor agent not found');

  // 3. 创建或复用对话
  const conversationId = ctx.conversationId || uuid();
  if (!ctx.conversationId) {
    const now = Date.now();
    db.insert(conversations).values({
      id: conversationId,
      tenant_id: ctx.tenantId,
      agent_id: supervisorId,
      user_id: ctx.userId,
      title: message.slice(0, 100),
      model_name: '',
      message_count: 0,
      total_tokens: 0,
      created_at: now,
      updated_at: now,
    }).run();
  }

  // 4. 构建 Supervisor system prompt（含团队成员描述和协调规则）
  const memberDescriptions = members
    .map((m) => `- **${m.agent_name}** (ID: ${m.agent_id}, 角色: ${m.role || '成员'}) → 使用 \`delegate_to_${m.agent_id}\` 委派任务`)
    .join('\n');

  const supervisorSystemPrompt = [
    supervisorRow.system_prompt,
    '',
    '## 团队协调指令',
    '你是团队协调者。分析用户需求，将子任务分配给最合适的成员。',
    '',
    '**团队成员：**',
    memberDescriptions,
    '',
    '**协调规则：**',
    '1. 分析请求，判断需要哪些成员参与',
    '2. 使用 delegate_to_<id> 工具将子任务委派给成员',
    '3. 多成员协作时依次委派，整合所有结果',
    '4. 整合后给出最终回复',
    '5. 简单问题可直接回复，无需委派',
  ].join('\n');

  // 5. 构建工具集（委派工具 + Skill 工具 + RAG 工具）
  const delegationTools = buildDelegationTools(members, ctx);
  const skillTools = getSkillToolsForMastraAgent(supervisorId, {
    tenantId: ctx.tenantId,
    agentId: supervisorId,
    userId: ctx.userId,
  });
  const ragTool = createRagTool(supervisorId);

  const aiTools: Record<string, any> = { ...delegationTools };
  for (const [name, t] of Object.entries(skillTools)) {
    aiTools[name] = tool({
      description: t.description,
      parameters: t.inputSchema,
      execute: async (args: any) => {
        const result = await t.execute({ context: { args } });
        return result;
      },
    });
  }
  if (ragTool) {
    aiTools[ragTool.id] = tool({
      description: ragTool.description,
      parameters: ragTool.inputSchema,
      execute: async (args: any) => {
        const result = await ragTool.execute({ context: { args } });
        return result;
      },
    });
  }

  // 6. 记忆与 RAG 上下文
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, message, 3);
  const ltmContext = ltmFacts.length > 0
    ? '\n\n## 长期记忆\n' + ltmFacts.map((f: { content: string }) => `- ${f.content}`).join('\n')
    : '';
  const ragContext = await getRagContext(supervisorId, message);
  const fullSystem = [supervisorSystemPrompt, ltmContext, ragContext].filter(Boolean).join('\n');

  // 短期记忆上下文
  const pastMessages = shortTermMemory.getContext(conversationId);
  const allMessages = [
    ...pastMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // 7. SSE 流处理
  const encoder = new TextEncoder();
  let finalText = '';

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 持久化用户消息
        db.insert(messages).values({
          id: uuid(),
          conversation_id: conversationId,
          role: 'user',
          content: message,
          token_usage: 0,
          created_at: Date.now(),
        }).run();

        const { textStream } = streamText({
          model: resolveAgentModel(ctx.tenantId, supervisorRow.model_id).model as any,
          system: fullSystem,
          messages: allMessages,
          tools: aiTools,
          maxSteps: 15,
          temperature: supervisorRow.temperature ?? 0.7,
          maxTokens: supervisorRow.max_tokens ?? 4096,
          onStepFinish: async (event) => {
            // 委派完成时发送 delegation_end 事件，通知前端子 Agent 的结果摘要
            if (event.toolResults) {
              for (const tr of event.toolResults) {
                if (tr.toolName.startsWith('delegate_to_')) {
                  const delegatedAgentId = tr.toolName.replace('delegate_to_', '');
                  const member = members.find((m) => m.agent_id === delegatedAgentId);
                  const resultText = typeof tr.result === 'string' ? tr.result : '';
                  enqueue({
                    type: 'delegation_end',
                    agentId: delegatedAgentId,
                    agentName: member?.agent_name || delegatedAgentId,
                    summary: resultText.length > 200 ? resultText.slice(0, 200) + '...' : resultText,
                  });
                }
              }
            }
          },
        });

        // 流式输出文本增量
        for await (const chunk of textStream) {
          finalText += chunk;
          enqueue({ type: 'text_delta', content: chunk });
        }

        // 持久化 assistant 消息
        db.insert(messages).values({
          id: uuid(),
          conversation_id: conversationId,
          role: 'assistant',
          content: finalText,
          tool_calls: null,
          token_usage: 0,
          created_at: Date.now(),
        }).run();

        // 更新短期记忆
        shortTermMemory.push(conversationId, { role: 'user', content: message, timestamp: Date.now() });
        shortTermMemory.push(conversationId, { role: 'assistant', content: finalText, timestamp: Date.now() });

        // 提取长期记忆（异步，非阻塞）
        if (config.memory.ltm_auto_extract) {
          longTermMemory.extractAndStore(ctx.tenantId, ctx.userId, [
            { role: 'user', content: message },
            { role: 'assistant', content: finalText },
          ]).catch(() => {});
        }

        enqueue({ type: 'done' });
      } catch (err: any) {
        enqueue({ type: 'error', message: err.message || 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });

  return { stream, metadata: { conversationId, teamId } };
}
