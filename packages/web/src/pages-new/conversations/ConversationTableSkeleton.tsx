import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

/**
 * 对话列表表格加载骨架屏
 *
 * 在对话数据加载期间渲染占位骨架行，保持与真实表格相同的列布局，
 * 使数据加载完成后的视觉跳变最小化。
 */
export default function ConversationTableSkeleton() {
  // 生成 5 个骨架行占位索引
  const skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  return (
    <Card>
      <CardHeader>
        <CardTitle>对话记录</CardTitle>
        <CardDescription>所有用户与 Agent 的对话记录</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>消息数</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skeletonRows.map((idx) => (
              <TableRow key={idx}>
                {/* User column skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                {/* Agent column skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                {/* Message count skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-10" />
                </TableCell>
                {/* Model name skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                {/* Timestamp skeleton */}
                <TableCell>
                  <Skeleton className="h-4 w-36" />
                </TableCell>
                {/* Actions skeleton */}
                <TableCell>
                  <Skeleton className="h-8 w-12 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
