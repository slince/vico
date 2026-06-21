import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { authRoutes } from './auth.js';
import { agentRoutes } from './agents.js';
import { skillRoutes } from './skills.js';
import { knowledgeRoutes } from './knowledge.js';
import { modelRoutes } from './models.js';
import { dashboardRoutes } from './dashboard.js';
import { chatRoutes } from './chat.js';
import { teamRoutes } from './teams.js';
import { conversationRoutes } from './conversations.js';
import { execApprovalRoutes } from './exec-approvals.js';
import { observabilityRoutes } from './observability.js';
export function registerRoutes(app: Hono<{ Variables: Variables }>) {
  authRoutes(app);
  agentRoutes(app);
  skillRoutes(app);
  knowledgeRoutes(app);
  modelRoutes(app);
  dashboardRoutes(app);
  chatRoutes(app);
  teamRoutes(app);
  conversationRoutes(app);
  execApprovalRoutes(app);
  observabilityRoutes(app);
}
