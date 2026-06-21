import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';

import type { Skill } from './types';

export interface SkillPanelProps {
  skillsList: Skill[];
  boundSkills: string[];
  onToggleSkill: (skillName: string, boundSkills: string[]) => void;
}

/**
 * Skill 绑定面板
 *
 * 展示所有可用 Skill 的复选框列表，勾选即绑定到当前 Agent。
 */
export default function SkillPanel({
  skillsList,
  boundSkills,
  onToggleSkill,
}: SkillPanelProps) {
  const { t } = useTranslation('agents');

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('skillBindTitle')}</CardTitle>
          <CardDescription>{t('skillBindDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {skillsList.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Puzzle size={24} />
              </EmptyMedia>
              <EmptyTitle>{t('skillsEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('skillsEmptyDesc')}</EmptyDescription>
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
