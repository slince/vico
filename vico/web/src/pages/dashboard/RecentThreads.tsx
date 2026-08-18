import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateOnly } from '@/lib/date-format';
import type { DashboardStats } from './types';

/**
 * 最近线程列表子组件
 *
 * 展示最近的线程记录，包含 Agent 名称、用户名、
 * 消息数量和最后更新时间。空数据时展示友好引导提示。
 *
 * @param props - 组件属性
 * @param props.threads - 最近线程数组
 * @returns 最近线程列表 JSX 元素
 */
export function RecentThreads({
  threads,
}: {
  threads: DashboardStats['recentThreads'];
}) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('recentThreads')}</CardTitle>
      </CardHeader>
      <CardContent>
        {threads.length > 0 ? (
          <div className="space-y-2">
            {threads.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/chat/${c.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/chat/${c.id}`); }}
                className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer hover:bg-muted/50 rounded-md px-2 -mx-2 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {c.title || c.agent_name || t('unknownAgent')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.title && c.agent_name ? <><Bot className="size-3 inline-block mr-0.5" />{c.agent_name} · </> : ''}{t('messagesCount', { count: c.message_count })}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 ml-3">
                  {formatDateOnly(c.updated_at)}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {t('noThreads')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
