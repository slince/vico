// 1. React

// 2. Third-party

// 3. API

// 4. UI components
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Chat 页面加载骨架屏。
 */
export function ChatSkeleton() {
  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      {/* 左侧面板骨架 */}
      <aside className="w-72 border-r bg-background p-3 space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-full" />
        <div className="space-y-2 pt-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </aside>

      {/* 右侧聊天区骨架 */}
      <div className="flex-1 flex flex-col bg-background">
        <div className="h-12 border-b" />
        <div className="flex-1 p-6 space-y-4 max-w-3xl mx-auto w-full">
          <div className="flex justify-end">
            <Skeleton className="h-16 w-3/4 rounded-lg" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-24 w-3/4 rounded-lg" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-12 w-1/2 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
