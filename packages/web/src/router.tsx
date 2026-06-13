import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
// 新版页面（shadcn/ui 重写）
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Agents from '@/pages/Agents';
import AgentDetail from '@/pages/AgentDetail';
import Teams from '@/pages/Teams';
import TeamDetail from '@/pages/TeamDetail';
import Skills from '@/pages/Skills';
import Conversations from '@/pages/Conversations';
import ConversationDetail from '@/pages/ConversationDetail';
import KnowledgeBases from '@/pages/KnowledgeBases';
import KnowledgeDetail from '@/pages/KnowledgeDetail';
import Settings from '@/pages/Settings';

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
        ],
      },
    ],
  },
]);
