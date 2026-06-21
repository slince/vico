import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';

import type { AgentOption } from './types';

export interface OverviewPanelProps {
  localName: string;
  onNameChange: (value: string) => void;
  localDescription: string;
  onDescriptionChange: (value: string) => void;
  localSupervisorId: string;
  onSupervisorChange: (value: string) => void;
  agentsList: AgentOption[];
}

/**
 * 团队概览面板
 *
 * 编辑团队名称、描述和协调者 Agent 选择。
 * 修改通过父组件的防抖逻辑自动保存。
 */
export default function OverviewPanel({
  localName,
  onNameChange,
  localDescription,
  onDescriptionChange,
  localSupervisorId,
  onSupervisorChange,
  agentsList,
}: OverviewPanelProps) {
  const { t } = useTranslation('teams');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overviewTitle')}</CardTitle>
        <CardDescription>{t('overviewDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="team-name">{t('teamName')}</Label>
          <Input
            id="team-name"
            value={localName}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-desc">{t('description')}</Label>
          <Input
            id="team-desc"
            value={localDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-supervisor">{t('supervisor')}</Label>
          <Select
            value={localSupervisorId}
            onValueChange={onSupervisorChange}
          >
            <SelectTrigger id="team-supervisor">
              <SelectValue placeholder={t('supervisorPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {agentsList.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
