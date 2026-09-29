import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
// 新版页面（shadcn/ui 重写）
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import AgentDetail from '@/pages/AgentDetail';
import KnowledgeDetail from '@/pages/KnowledgeDetail';
import Settings from '@/pages/Settings';
import Chat from '@/pages/Chat';

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
          { path: 'chat', element: <Chat /> },
          { path: 'chat/:threadId', element: <Chat /> },
          { path: 'agents/:id', element: <AgentDetail /> },
          { path: 'knowledge/:id', element: <KnowledgeDetail /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
]);
