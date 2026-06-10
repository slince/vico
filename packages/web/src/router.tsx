import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuthProvider } from '@/hooks/useAuth';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Agents from '@/pages/Agents';
import AgentDetail from '@/pages/AgentDetail';
import Skills from '@/pages/Skills';
import Conversations from '@/pages/Conversations';
import ConversationDetail from '@/pages/ConversationDetail';
import KnowledgeBases from '@/pages/KnowledgeBases';
import KnowledgeDetail from '@/pages/KnowledgeDetail';
import Settings from '@/pages/Settings';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('vico_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: (
      <AuthProvider>
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      </AuthProvider>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'agents', element: <Agents /> },
      { path: 'agents/:id', element: <AgentDetail /> },
      { path: 'skills', element: <Skills /> },
      { path: 'knowledge', element: <KnowledgeBases /> },
      { path: 'knowledge/:id', element: <KnowledgeDetail /> },
      { path: 'conversations', element: <Conversations /> },
      { path: 'conversations/:id', element: <ConversationDetail /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
