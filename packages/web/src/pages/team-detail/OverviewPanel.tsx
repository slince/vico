import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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

import type { AgentOption } from './types';

/** OverviewPanel 组件的 props */
export interface OverviewPanelProps {
  /** 本地团队名称 */
  localName: string;
  /** 更新团队名称 */
  onNameChange: (value: string) => void;
  /** 本地团队描述 */
  localDescription: string;
  /** 更新团队描述 */
  onDescriptionChange: (value: string) => void;
  /** 本地协调者 Agent ID */
  localSupervisorId: string;
  /** 更新协调者 Agent ID */
  onSupervisorChange: (value: string) => void;
  /** 可用 Agent 列表 */
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>团队配置</CardTitle>
        <CardDescription>
          编辑团队基本信息和协调策略
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="team-name">团队名称</Label>
          <Input
            id="team-name"
            value={localName}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-desc">描述</Label>
          <Input
            id="team-desc"
            value={localDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-supervisor">协调者 Agent</Label>
          <Select
            value={localSupervisorId}
            onValueChange={onSupervisorChange}
          >
            <SelectTrigger id="team-supervisor">
              <SelectValue placeholder="选择协调者 Agent" />
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
