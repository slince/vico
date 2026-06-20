/**
 * Vico Agent Framework — Quickstart Demo
 *
 * 演示最小可运行用例：
 *   1. Vico 一键装配所有服务
 *   2. FakeModelClient 模拟 LLM（无需 API Key）
 *   3. 运行一个带工具调用的对话 turn
 *
 * 运行：pnpm start
 */

import {
  Vico,
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

    yield { type: 'text_delta', content: `Echo bot says: I heard you! How can I help further?` };
    yield { type: 'usage', input: 80, output: 30 };
  }
}

// ─── 2. 启动 + 运行 ──────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('  Vico Agent Framework — Quickstart Demo');
  console.log('═'.repeat(60));

  // 一键装配
  const vico = new Vico({
    skillRoots: [resolve(__dirname, 'skills')],
  });
  await vico.init();

  // 打印已加载的 Skill
  console.log('📦 Skills loaded:');
  for (const skill of vico.getSkillManager().listAll()) {
    console.log(`   - ${skill.name}: ${skill.description}`);
  }

  // 监听事件
  vico.events.on('text_delta', (data) => process.stdout.write((data as any).content as string));
  vico.events.on('tool_call_start', (data) => {
    const d = data as any;
    console.log(`\n🔧 Calling tool: ${d.name}(${d.id})`);
  });
  vico.events.on('tool_result', (data) => {
    const d = data as any;
    console.log(`✅ Tool result [${d.status}]: ${d.name}`);
  });
  vico.events.on('step_start', (data) => console.log(`\n📍 Step ${(data as any).step}`));
  vico.events.on('done', (data) => console.log(`\n✨ Done. Usage: ${JSON.stringify((data as any).usage)}`));

  // 创建 Agent
  const config = {
    id: 'echo-agent',
    tenantId: 'demo',
    name: 'Echo Bot',
    systemPrompt: 'You are a friendly echo bot. Call the echo tool when asked to repeat something.',
    model: { provider: 'mock' as const, model: 'mock-model' },
    temperature: 0.7,
    maxTokens: 1024,
    maxSteps: 5,
  };

  const agent = await vico.createAgent(config, new FakeModelClient());

  const userMessage = { role: 'user' as const, content: 'Hello! Can you echo back "Vico is awesome"?' };

  console.log(`\n👤 User: ${userMessage.content}`);
  console.log('🤖 Assistant: ');

  const result = await agent.loop.runTurn(
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
