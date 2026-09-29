import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ChatProvider } from '@/providers/chat-provider';

export function Layout() {
  return (
    <ChatProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </ChatProvider>
  );
}
