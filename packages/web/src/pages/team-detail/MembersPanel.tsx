import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';

import type { AgentOption, Member } from './types';

/** MembersPanel 组件的 props */
export interface MembersPanelProps {
  /** 尚未加入团队的 Agent（用于添加） */
  availableForAdd: AgentOption[];
  /** 当前成员列表 */
  members: Member[];
  /** 添加成员回调 */
  onAddMember: (agentId: string) => void;
  /** 移除成员回调 */
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
  return (
    <div className="space-y-4">
      {/* 添加成员 */}
      <Card>
        <CardHeader>
          <CardTitle>添加成员</CardTitle>
          <CardDescription>
            选择要加入团队的 Agent
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select onValueChange={onAddMember}>
            <SelectTrigger>
              <SelectValue placeholder="选择 Agent..." />
            </SelectTrigger>
            <SelectContent>
              {availableForAdd.length === 0 ? (
                <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                  所有 Agent 已在团队中
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

      {/* 当前成员列表 */}
      <Card>
        <CardHeader>
          <CardTitle>当前成员 ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无成员</p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-2 px-3 bg-accent rounded-md"
              >
                <div>
                  <p className="text-sm font-medium">{m.agent_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.role || '成员'}
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
