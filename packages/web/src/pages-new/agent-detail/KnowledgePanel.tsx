import { Database } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

import type { KnowledgeBase } from './types';

/** KnowledgePanel 组件的 props */
export interface KnowledgePanelProps {
  /** 可用知识库列表 */
  kbsList: KnowledgeBase[];
  /** 已绑定的知识库 ID 列表 */
  boundKbs: string[];
  /** 知识库复选框切换回调 */
  onToggleKb: (kbId: string, boundKbs: string[]) => void;
}

/**
 * 知识库绑定面板
 *
 * 展示所有可用知识库的复选框列表，勾选即关联到当前 Agent。
 * Agent 将在对话中检索已关联知识库的文档内容作为上下文。
 *
 * @param props - 组件属性
 * @returns 知识库绑定面板 JSX 元素
 */
export default function KnowledgePanel({
  kbsList,
  boundKbs,
  onToggleKb,
}: KnowledgePanelProps) {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>绑定知识库</CardTitle>
          <CardDescription>
            勾选要关联的知识库，Agent 将在对话中检索其中的文档内容作为上下文。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kbsList.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Database size={24} />
              </EmptyMedia>
              <EmptyTitle>暂无知识库</EmptyTitle>
              <EmptyDescription>
                请先到知识库页上传文档并创建知识库
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="space-y-1">
              {kbsList.map((kb) => {
                const isBound = boundKbs.includes(kb.id);
                return (
                  <label
                    key={kb.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors has-checked:bg-accent/50"
                  >
                    <Checkbox
                      checked={isBound}
                      onCheckedChange={() => onToggleKb(kb.id, boundKbs)}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none">
                        {kb.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {kb.chunk_count} 个文档块
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
