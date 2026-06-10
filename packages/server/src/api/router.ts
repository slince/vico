import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { agentRoutes } from './agents.js';
import { skillRoutes } from './skills.js';
import { knowledgeRoutes } from './knowledge.js';
import { conversationRoutes } from './conversations.js';
import { modelRoutes } from './models.js';
import { dashboardRoutes } from './dashboard.js';
import { chatRoutes } from './chat.js';

export function registerRoutes(app: FastifyInstance) {
  authRoutes(app);
  agentRoutes(app);
  skillRoutes(app);
  knowledgeRoutes(app);
  conversationRoutes(app);
  modelRoutes(app);
  dashboardRoutes(app);
  chatRoutes(app);
}
