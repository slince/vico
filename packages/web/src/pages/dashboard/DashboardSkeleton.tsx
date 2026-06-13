import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * 仪表盘加载骨架屏组件
 *
 * 在数据加载期间展示 5 张带骨架效果的卡片占位，
 * 以及下方趋势图和对话列表区域的骨架占位，
 * 提供良好的感知性能体验。
 *
 * @returns 骨架屏 JSX 元素
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* 标题骨架 */}
      <Skeleton className="h-8 w-28" />

      {/* 5 张统计卡片骨架 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3">
              {/* 图标骨架 */}
              <Skeleton className="h-9 w-9 rounded-md shrink-0" />
              <div className="space-y-2 flex-1">
                {/* 数值骨架 */}
                <Skeleton className="h-7 w-16" />
                {/* 标签骨架 */}
                <Skeleton className="h-3 w-12" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 趋势图 + 对话列表骨架 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token 趋势图骨架 */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>

        {/* 最近对话列表骨架 */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
