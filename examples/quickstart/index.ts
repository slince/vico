/**
 * Vico Agent Framework — Quickstart Demo
 *
 * 运行：pnpm start（无需 API Key，使用内置 mock 模型）
 */
import type {ModelClient, ModelRequest, ModelStreamChunk} from '@vico/agent';
import {MemoryStore, Vico} from '@vico/agent';

// FakeModelClient — 模拟 LLM 响应，自动调用 echo 工具
class FakeModelClient implements ModelClient {
  readonly provider = 'mock';
  readonly model = 'mock-model';

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const userMsg = request.messages.filter((m) => m.role === 'user').pop();
    yield {
      type: 'tool_call_complete',
      id: 'call_1',
      name: 'echo',
      args: { message: userMsg?.content ?? 'nothing' },
    };
    yield { type: 'text_delta', content: 'Done! Anything else?' };
    yield { type: 'usage', input: 120, output: 40 };
  }
}

async function main() {
  // 一键装配：Skill + Memory + MockModel
  const vico = new Vico({
    skillRoots: ['skills'],
    memory: new MemoryStore(),
    modelFactory: () => new FakeModelClient(),
  });
  await vico.init();

  console.log('Skills:', vico.getSkillManager().listAll().map((s) => s.name));

  // 创建 Agent 并注册到 Runtime
  await vico.runtime.createAgent({
    id: 'echo-agent',
    name: 'Echo Bot',
    systemPrompt: 'You are an echo bot. Use the echo tool to repeat user messages.',
    model: { provider: 'mock', model: 'mock-model' },
    temperature: 0.7,
    maxTokens: 1024,
    maxSteps: 5,
  });

  // 一行对话
  const result = await vico.invoke('echo-agent', 'Hello! Please echo "Vico is awesome".');
  console.log('Result:', result.status, 'steps:', result.steps, 'usage:', result.usage);
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
