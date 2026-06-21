import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';

import type { KnowledgeBase } from './types';

export interface KnowledgePanelProps {
  kbsList: KnowledgeBase[];
  selectedKbId: string | null;
  onSelectKb: (kbId: string | null) => void;
}

/**
 * 知识库绑定面板
 *
 * 展示所有可用知识库的单选列表，选中即关联到当前 Agent。
 */
export default function KnowledgePanel({
  kbsList,
  selectedKbId,
  onSelectKb,
}: KnowledgePanelProps) {
  const { t } = useTranslation('agents');

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('kbBindTitle')}</CardTitle>
          <CardDescription>{t('kbBindDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {kbsList.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Database size={24} />
              </EmptyMedia>
              <EmptyTitle>{t('knowledgeEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('knowledgeEmptyDesc')}</EmptyDescription>
            </Empty>
          ) : (
            <RadioGroup
              value={selectedKbId ?? '__none__'}
              onValueChange={(v) => onSelectKb(v === '__none__' ? null : v)}
            >
              <div className="space-y-1">
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors">
                  <RadioGroupItem value="__none__" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none text-muted-foreground">
                      {t('noKb')}
                    </p>
                  </div>
                </label>
                {kbsList.map((kb) => (
                  <label
                    key={kb.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors"
                  >
                    <RadioGroupItem value={kb.id} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none">
                        {kb.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('common:chunks', { count: kb.chunk_count })}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </RadioGroup>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
