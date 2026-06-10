import { FastifyInstance } from 'fastify';
import { runPipeline } from '../agent/pipeline.js';

export function chatRoutes(app: FastifyInstance) {
  app.post('/api/v1/chat', async (req, reply) => {
    const ctx = req.authContext!;
    const { agentId, conversationId, message } = req.body as any;

    if (!agentId || !message) {
      return reply.status(400).send({ error: 'agentId and message are required' });
    }

    const result = await runPipeline(message, {
      tenantId: ctx.tenantId,
      agentId,
      userId: ctx.userId,
      conversationId: conversationId || undefined,
    });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': result.metadata.conversationId,
    });

    const reader = result.stream.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          reply.raw.end();
          break;
        }
        reply.raw.write(value);
      }
    };
    pump().catch(() => {
      reply.raw.end();
    });

    return reply.hijack();
  });
}
