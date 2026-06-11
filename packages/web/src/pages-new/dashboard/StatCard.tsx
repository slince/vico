import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * 单张统计卡片子组件
 *
 * 使用 shadcn/ui Card 包裹，展示图标、数值和标签。
 * Agent 状态卡片额外使用 Badge 标注活跃数量。
 *
 * @param props - 卡片配置
 * @param props.label - 卡片标签
 * @param props.value - 格式化后的展示值
 * @param props.icon - lucide-react 图标组件
 * @param props.iconColor - 图标容器颜色类名
 * @returns 统计卡片 JSX 元素
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number }>;
  iconColor: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        {/* 图标容器 */}
        <div className={cn('p-2 rounded-md shrink-0', iconColor)}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          {/* 数值展示 */}
          <p className="text-2xl font-bold truncate">{value}</p>
          {/* 标签文字 */}
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
