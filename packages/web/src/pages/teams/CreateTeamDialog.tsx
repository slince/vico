import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/** CreateTeamDialog 组件属性 */
interface CreateTeamDialogProps {
  /** 当前输入的团队名称 */
  name: string;
  /** 团队名称变更回调 */
  onNameChange: (name: string) => void;
  /** 当前输入的团队描述 */
  description: string;
  /** 团队描述变更回调 */
  onDescriptionChange: (description: string) => void;
  /** 提交表单回调 */
  onSubmit: () => void;
  /** 创建变更的 mutation 状态 */
  mutation: {
    error: Error | null;
    isPending: boolean;
  };
}

/**
 * 创建团队对话框
 *
 * 提供团队名称和描述输入表单，支持回车快捷提交。
 * 在 mutation 出错时展示错误信息，提交中展示 pending 状态。
 *
 * @param props - 对话框属性，包括表单状态、变更回调和 mutation 状态
 */
export default function CreateTeamDialog(props: CreateTeamDialogProps) {
  const { name, onNameChange, description, onDescriptionChange, onSubmit, mutation } = props;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>创建 Agent 团队</DialogTitle>
        <DialogDescription>
          创建一个 Agent 团队，将多个 Agent 组合在一起，通过协调者自动分配任务。
        </DialogDescription>
      </DialogHeader>

      {/* 表单主体 */}
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="team-name">团队名称</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="例如：客服团队、数据分析团队"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="team-description">团队描述</Label>
          <Textarea
            id="team-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="描述团队的用途和协作方式（可选）"
            rows={3}
          />
        </div>

        {/* 错误信息展示 */}
        {mutation.error && (
          <p className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
      </div>

      <DialogFooter>
        {/* 取消按钮：关闭 Dialog */}
        <DialogClose asChild>
          <Button variant="outline">取消</Button>
        </DialogClose>
        {/* 确认创建：名称非空时可用 */}
        <Button onClick={onSubmit} disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? '创建中...' : '创建'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
