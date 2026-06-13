import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
// 新版页面（shadcn/ui 重写）
import Login from '@/pages-new/Login';
import Dashboard from '@/pages-new/Dashboard';
import Agents from '@/pages-new/Agents';
import AgentDetail from '@/pages-new/AgentDetail';
import Teams from '@/pages-new/Teams';
import TeamDetail from '@/pages-new/TeamDetail';
import Skills from '@/pages-new/Skills';
import Conversations from '@/pages-new/Conversations';
import ConversationDetail from '@/pages-new/ConversationDetail';
import KnowledgeBases from '@/pages-new/KnowledgeBases';
import KnowledgeDetail from '@/pages-new/KnowledgeDetail';
import Settings from '@/pages-new/Settings';

// 旧版页面（/old 路由下保留对照）
import OldLogin from '@/pages/Login';
import OldDashboard from '@/pages/Dashboard';
import OldAgents from '@/pages/Agents';
import OldAgentDetail from '@/pages/AgentDetail';
import OldSkills from '@/pages/Skills';
import OldConversations from '@/pages/Conversations';
import OldConversationDetail from '@/pages/ConversationDetail';
import OldKnowledgeBases from '@/pages/KnowledgeBases';
import OldKnowledgeDetail from '@/pages/KnowledgeDetail';
import OldSettings from '@/pages/Settings';

function AuthWrapper() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

/** 路由守卫 — 基于 better-auth session 状态（非 localStorage） */
function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout />;
}

export const router = createBrowserRouter([
  {
    element: <AuthWrapper />,
    children: [
      { path: '/login', element: <Login /> },
      {
        element: <ProtectedRoute />,
        children: [
          // ===================== 新版路由（默认） =====================
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'agents', element: <Agents /> },
          { path: 'agents/:id', element: <AgentDetail /> },
          { path: 'teams', element: <Teams /> },
          { path: 'teams/:id', element: <TeamDetail /> },
          { path: 'skills', element: <Skills /> },
          { path: 'knowledge', element: <KnowledgeBases /> },
          { path: 'knowledge/:id', element: <KnowledgeDetail /> },
          { path: 'conversations', element: <Conversations /> },
          { path: 'conversations/:id', element: <ConversationDetail /> },
          { path: 'settings', element: <Settings /> },

          // ===================== 旧版路由（/old 前缀） =====================
          { path: 'old', index: true, element: <Navigate to="/old/dashboard" replace /> },
          { path: 'old/dashboard', element: <OldDashboard /> },
          { path: 'old/agents', element: <OldAgents /> },
          { path: 'old/agents/:id', element: <OldAgentDetail /> },
          { path: 'old/skills', element: <OldSkills /> },
          { path: 'old/knowledge', element: <OldKnowledgeBases /> },
          { path: 'old/knowledge/:id', element: <OldKnowledgeDetail /> },
          { path: 'old/conversations', element: <OldConversations /> },
          { path: 'old/conversations/:id', element: <OldConversationDetail /> },
          { path: 'old/settings', element: <OldSettings /> },
        ],
      },
    ],
  },
]);
