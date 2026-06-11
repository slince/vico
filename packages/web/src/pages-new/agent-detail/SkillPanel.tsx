import { Puzzle } from 'lucide-react';
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

import type { Skill } from './types';

/** SkillPanel 组件的 props */
export interface SkillPanelProps {
  /** 可用 Skill 列表 */
  skillsList: Skill[];
  /** 已绑定的 Skill 名称列表 */
  boundSkills: string[];
  /** Skill 复选框切换回调 */
  onToggleSkill: (skillName: string, boundSkills: string[]) => void;
}

/**
 * Skill 绑定面板
 *
 * 展示所有可用 Skill 的复选框列表，勾选即绑定到当前 Agent。
 * 取消勾选则解绑。无可用 Skill 时展示 Empty 空状态。
 *
 * @param props - 组件属性
 * @returns Skill 绑定面板 JSX 元素
 */
export default function SkillPanel({
  skillsList,
  boundSkills,
  onToggleSkill,
}: SkillPanelProps) {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>绑定 Skill 插件</CardTitle>
          <CardDescription>
            勾选需要为此 Agent 启用的 Skill。Skill 可扩展 Agent 的工具能力。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {skillsList.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Puzzle size={24} />
              </EmptyMedia>
              <EmptyTitle>暂无可用 Skill</EmptyTitle>
              <EmptyDescription>
                请先到 Skill 管理页安装插件
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="space-y-1">
              {skillsList.map((s) => {
                const isBound = boundSkills.includes(s.name);
                return (
                  <label
                    key={s.name}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors has-checked:bg-accent/50"
                  >
                    <Checkbox
                      checked={isBound}
                      onCheckedChange={() =>
                        onToggleSkill(s.name, boundSkills)
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none">
                        {s.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {s.description}
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
