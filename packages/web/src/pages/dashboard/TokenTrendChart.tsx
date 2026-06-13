import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { DashboardStats } from './types';

/**
 * Token 消耗趋势简易柱状图子组件
 *
 * 使用纯 CSS 柱形图展示近 30 天 Token 消耗趋势。
 * 每根柱子的高度相对于最大值按比例缩放，最小高度 2% 以保证可见性。
 * 空数据时展示友好提示。
 *
 * @param props - 组件属性
 * @param props.data - token 趋势数据数组
 * @returns 趋势图表 JSX 元素
 */
export function TokenTrendChart({ data }: { data: DashboardStats['tokenTrend'] }) {
  // 计算所有天中的最大值，用于柱子高度的比例缩放
  const max = Math.max(...data.map((d) => d.total), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Token 消耗趋势 (近30天)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="flex items-end gap-1 h-32">
            {data.map((d, i) => {
              // 按最大值比例计算柱高百分比，最小值不低于 2% 确保可见
              const height = max > 0 ? Math.max((d.total / max) * 100, 2) : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-primary/20 hover:bg-primary/40 rounded-t transition-colors"
                    style={{ height: `${height}%` }}
                    title={`${d.day}: ${d.total.toLocaleString()} tokens`}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          // 空数据友好提示
          <p className="text-sm text-muted-foreground py-6 text-center">
            暂无 Token 消耗数据，开始使用 Agent 后将在此展示趋势
          </p>
        )}
      </CardContent>
    </Card>
  );
}
