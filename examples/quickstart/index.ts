/**
 * Vico Agent Framework — Quickstart Demo
 *
 * 演示最小可运行用例：
 *   1. 启动 AgentRuntime + LocalToolHost + SkillManager
 *   2. 注册 echo/now 内置工具
 *   3. 加载 echo-bot Skill
 *   4. 使用 FakeModelClient 运行一个对话 turn（无需 API Key）
 *
 * 运行：pnpm start
 */

import {
  AgentLoopImpl,
  PromptAssemblerImpl,
  MittEventRecorder,
  InMemorySpanTracker,
  CompositeHookRunner,
  LocalToolHost,
  SkillManager,
  FSSkillLoader,
} from '@vico/agent';
import type { ModelClient, ModelRequest, ModelStreamChunk, ToolCall } from '@vico/agent';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 1. FakeModelClient — 模拟 LLM，无需 API Key ────────────────────────

class FakeModelClient implements ModelClient {
  readonly provider = 'mock';
  readonly model = 'mock-model';
  private callCount = 0;

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.callCount++;
    const userMessage = request.messages.filter((m) => m.role === 'user').pop();

    // 第一轮：模拟 LLM 决定调用 echo 工具
    if (this.callCount === 1) {
      yield { type: 'reasoning_delta', content: '用户想让我 echo 一段话，我应该用 echo 工具...' };

      const toolCall: ToolCall = {
        id: 'call_1',
        name: 'echo',
        args: { message: (userMessage?.content ?? 'nothing') },
      };

      yield {
        type: 'tool_call_complete',
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      };

      yield { type: 'usage', input: 120, output: 40 };
      return;
    }

    // 后续轮次（工具已执行完毕）：文本回复
    yield { type: 'text_delta', content: `Echo bot says: I heard you! How can I help further?` };
    yield { type: 'usage', input: 80, output: 30 };
  }
}

// ─── 2. 引导启动函数 ──────────────────────────────────────────────────

async function bootstrap() {
  // 2.1 创建工具系统（内置 echo + now）
  const toolHost = new LocalToolHost();

  // 2.2 创建 Skill 系统，加载示例 Skill
  const skillLoader = new FSSkillLoader();
  const skillManager = new SkillManager(skillLoader);
  const skillsDir = resolve(__dirname, 'skills');
  await skillManager.discover([skillsDir]);

  console.log('📦 Skills loaded:');
  for (const skill of skillManager.listAll()) {
    console.log(`   - ${skill.name}: ${skill.description}`);
  }

  // 2.3 事件 + 追踪
  const events = new MittEventRecorder();
  const spanTracker = new InMemorySpanTracker();

  // 监听 SSE 事件（演示用）
  events.on('text_delta', (data) => process.stdout.write((data as any).content as string));
  events.on('tool_call_start', (data) => {
    const d = data as any;
    console.log(`\n🔧 Calling tool: ${d.name}(${d.id})`);
  });
  events.on('tool_result', (data) => {
    const d = data as any;
    console.log(`✅ Tool result [${d.status}]: ${d.name}`);
  });
  events.on('step_start', (data) => console.log(`\n📍 Step ${(data as any).step}`));
  events.on('done', (data) => console.log(`\n✨ Done. Usage: ${JSON.stringify((data as any).usage)}`));

  // 2.4 创建 AgentLoop（将 FakeModelClient 作为模型后端）
  const agentConfig = {
    id: 'echo-agent',
    tenantId: 'demo',
    name: 'Echo Bot',
    systemPrompt: 'You are a friendly echo bot. Call the echo tool when asked to repeat something.',
    model: { provider: 'mock' as const, model: 'mock-model' },
    temperature: 0.7,
    maxTokens: 1024,
    maxSteps: 5,
  };

  const modelClient = new FakeModelClient();
  const promptAssembler = new PromptAssemblerImpl();

  // 需要先生成工具列表
  const allTools = await toolHost.listTools({
    tenantId: 'demo',
    userId: 'user-1',
    agentId: 'echo-agent',
    threadId: 'thread-1',
    workspace: '/tmp',
    hooks: [],
    awaitApproval: async () => ({ approved: true }),
    signal: new AbortController().signal,
  });

  console.log(`🔧 Tools available: ${allTools.map((t) => t.name).join(', ')}`);

  const loop = new AgentLoopImpl({
    config: agentConfig,
    model: modelClient,
    toolHost,
    promptAssembler,
    events,
    spanTracker,
    hooks: new CompositeHookRunner(),
  });

  return { loop, events, skillManager };
}

// ─── 3. 运行对话 ──────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('  Vico Agent Framework — Quickstart Demo');
  console.log('═'.repeat(60));

  const { loop } = await bootstrap();

  const userMessage = { role: 'user' as const, content: 'Hello! Can you echo back "Vico is awesome"?' };

  console.log(`\n👤 User: ${userMessage.content}`);
  console.log('🤖 Assistant: ');

  const result = await loop.runTurn(
    'thread-demo',
    [],
    userMessage,
    new AbortController().signal,
  );

  console.log(`\n\n📊 Turn result: status=${result.status}, steps=${result.steps}`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
