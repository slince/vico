/**
 * Agent Team Orchestrator — 多 Agent 协作编排引擎
 *
 * 使用 supervisor + delegation 模式实现多 Agent 协作。
 * Supervisor Agent 获得 delegate_to_<agentId> 工具，可委派子任务给团队成员。
 * 子 Agent 在进程内执行 streamText，收集文本结果后返回给 Supervisor 进行综合回复。
 *
 * SSE 事件类型：
 * - text_delta:       { type, content }
 * - delegation_start: { type, agentId, agentName }
 * - delegation_end:   { type, agentId, agentName, summary }
 * - done:             { type }
 * - error:            { type, message }
 */
import { tool, streamText } from 'ai';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../db/db.js';
import { config } from '../config.js';
import { ragManager } from '../memory/rag.js';
import { skillManager } from '../skill/manager.js';
import { getDefaultModel, getModelById } from './model-registry.js';
import { resolveModelProvider } from './agent-factory.js';
import { getSkillToolsForMastraAgent } from './tools/skill-tool-adapter.js';
import { createRagSearchTool } from './tools/rag-tool.js';
import { workingMemory } from './memory/working-memory.js';
import { observationalMemory } from './memory/observational-memory.js';

const { agentTeams, agentTeamMembers, agents, conversations, messages } = schema;

/** 管道运行时上下文 */
interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}

/**
 * 解析 Agent 使用的模型。
 * 若 agent 指定了 model_id，使用该模型；否则使用租户默认模型。
 */
function resolveAgentModel(tenantId: string, modelId?: string) {
  let modelConfig = modelId ? getModelById(tenantId, modelId) : getDefaultModel(tenantId);
  if (!modelConfig) {
    throw new Error('No LLM model configured. Please add a model in Settings first.');
  }
  return {
    model: resolveModelProvider(modelConfig),
    modelConfig,
  };
}

/**
 * 获取 Agent 绑定的 RAG 知识库上下文文本，直接注入 system prompt。
 */
async function getRagContext(agentId: string, query: string): Promise<string> {
  const db = getDb();
  const { agent_knowledge_bases: akb } = schema;
  const bindings = db.select({ kb_id: akb.kb_id })
    .from(akb)
    .where(eq(akb.agent_id, agentId))
    .all();

  if (bindings.length === 0) return '';

  const kbIds = bindings.map((b) => b.kb_id);
  const chunks = await ragManager.hybridSearch(query, kbIds, config.rag.retrieval_top_k);

  if (chunks.length === 0) return '';
  return '\n\n## 相关知识库内容\n' + chunks.map((c) => c.content).join('\n\n');
}

/**
 * 执行子 Agent 并收集其完整文本响应。
 * 复用与单 Agent 管道相同的模型/Skills/RAG 层。
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

  // 构建系统提示词：Agent prompt + Skill prompt + RAG
  const skillPrompt = skillManager.getPromptForAgent(agentId);
  const ragContext = await getRagContext(agentId, task);
  const systemPrompt = [
    agentRow.system_prompt,
    skillPrompt,
    ragContext,
  ].filter(Boolean).join('\n');

  // 构建子 Agent 的工具集（Skill tools + RAG tool）
  const skillTools = getSkillToolsForMastraAgent(agentId, {
    tenantId: ctx.tenantId,
    agentId,
    userId: ctx.userId,
    skillConfig: {},
  });

  const aiTools: Record<string, any> = { ...skillTools };

  const ragTool = await createRagSearchTool(agentId, ctx.tenantId);
  if (ragTool) {
    aiTools[ragTool.id] = ragTool;
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
    skillConfig: {},
  });

  const aiTools: Record<string, any> = { ...delegationTools, ...skillTools };

  const ragTool = await createRagSearchTool(supervisorId, ctx.tenantId);
  if (ragTool) {
    aiTools[ragTool.id] = ragTool;
  }

  // 6. 记忆与 RAG 上下文
  // WorkingMemory: 用户事实/偏好（Phase 3）
  const workingContext = await workingMemory.retrieveAsPrompt(ctx.tenantId, ctx.userId);

  // ObservationalMemory: 对话历史摘要（Phase 3）
  let observationContext = '';
  if (conversationId) {
    const obsRows = await observationalMemory.retrieve(ctx.tenantId, conversationId);
    observationContext = observationalMemory.retrieveAsPrompt(obsRows);
  }

  const ragContext = await getRagContext(supervisorId, message);
  const fullSystem = [supervisorSystemPrompt, workingContext, observationContext, ragContext].filter(Boolean).join('\n');

  // 查询最近消息作为对话历史（替代已删除的 shortTermMemory）
  const recentMessages = db.select({
    role: messages.role,
    content: messages.content,
  })
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(messages.created_at)
    .limit(20)
    .all();

  const allMessages = [
    ...recentMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
            // 委派开始时发送 delegation_start 事件，通知前端子 Agent 开始工作
            if (event.toolCalls) {
              for (const tc of event.toolCalls) {
                if (tc.toolName.startsWith('delegate_to_')) {
                  const delegatedAgentId = tc.toolName.replace('delegate_to_', '');
                  const member = members.find((m) => m.agent_id === delegatedAgentId);
                  enqueue({
                    type: 'delegation_start',
                    agentId: delegatedAgentId,
                    agentName: member?.agent_name || delegatedAgentId,
                  });
                }
              }
            }
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

        // Phase 3: WorkingMemory 提取（异步，非阻塞）
        workingMemory.extractAndStore(ctx.tenantId, ctx.userId, [
          { role: 'user', content: message },
          { role: 'assistant', content: finalText },
        ]).catch(() => {});

        // Phase 3: ObservationalMemory 压缩检查（异步，非阻塞）
        observationalMemory.maybeCompress(ctx.tenantId, conversationId).catch(() => {});

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
