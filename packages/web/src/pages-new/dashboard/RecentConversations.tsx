import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DashboardStats } from './types';

/**
 * 最近对话列表子组件
 *
 * 展示最近的对话记录，包含 Agent 名称、用户名、
 * 消息数量和最后更新时间。空数据时展示友好引导提示。
 *
 * @param props - 组件属性
 * @param props.conversations - 最近对话数组
 * @returns 最近对话列表 JSX 元素
 */
export function RecentConversations({
  conversations,
}: {
  conversations: DashboardStats['recentConversations'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">最近对话</CardTitle>
      </CardHeader>
      <CardContent>
        {conversations.length > 0 ? (
          <div className="space-y-2">
            {conversations.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                {/* 左侧：Agent 名称与用户信息 */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {c.agent_name || '未知 Agent'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.user_name} &middot; {c.message_count} 条消息
                  </p>
                </div>
                {/* 右侧：更新日期 Badge */}
                <Badge variant="secondary" className="shrink-0 ml-3">
                  {new Date(c.updated_at).toLocaleDateString('zh-CN')}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          // 空数据友好提示
          <p className="text-sm text-muted-foreground py-6 text-center">
            暂无对话记录，创建 Agent 并开始聊天后将在此展示
          </p>
        )}
      </CardContent>
    </Card>
  );
}
