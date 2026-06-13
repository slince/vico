import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';

import type { AgentOption, Member } from './types';

export interface MembersPanelProps {
  availableForAdd: AgentOption[];
  members: Member[];
  onAddMember: (agentId: string) => void;
  onRemoveMember: (agentId: string) => void;
}

/**
 * 团队成员管理面板
 *
 * 包含添加成员下拉和当前成员列表，支持一键移除。
 */
export default function MembersPanel({
  availableForAdd,
  members,
  onAddMember,
  onRemoveMember,
}: MembersPanelProps) {
  const { t } = useTranslation('teams');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('addMember')}</CardTitle>
          <CardDescription>{t('addMemberDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select onValueChange={onAddMember}>
            <SelectTrigger>
              <SelectValue placeholder={t('addMemberPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {availableForAdd.length === 0 ? (
                <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                  {t('allAgentsInTeam')}
                </div>
              ) : (
                availableForAdd.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('currentMembers')} ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noMembers')}</p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-2 px-3 bg-accent rounded-md"
              >
                <div>
                  <p className="text-sm font-medium">{m.agent_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.role || t('memberRole')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveMember(m.agent_id)}
                >
                  <X size={14} />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
