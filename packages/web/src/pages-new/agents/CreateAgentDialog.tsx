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
import { Label } from '@/components/ui/label';

/** CreateAgentDialog 组件属性 */
interface CreateAgentDialogProps {
  /** 当前输入的 Agent 名称 */
  name: string;
  /** Agent 名称变更回调 */
  onNameChange: (name: string) => void;
  /** 提交表单回调 */
  onSubmit: () => void;
  /** 创建变更的 mutation 状态（不含 any 类型） */
  mutation: {
    error: Error | null;
    isPending: boolean;
  };
}

/**
 * 创建 Agent 对话框
 *
 * 提供 Agent 名称输入表单，支持回车快捷提交。
 * 在 mutation 出错时展示错误信息，提交中展示 pending 状态。
 *
 * @param props - 对话框属性，包括表单状态、变更回调和 mutation 状态
 */
export default function CreateAgentDialog(props: CreateAgentDialogProps) {
  const { name, onNameChange, onSubmit, mutation } = props;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>创建 Agent</DialogTitle>
        <DialogDescription>
          输入 Agent 名称以创建新的智能代理。后续可在详情页配置模型、系统提示词、Skill 绑定等。
        </DialogDescription>
      </DialogHeader>

      {/* 表单主体 */}
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Agent 名称</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="例如：客服助手、数据分析师"
            // 支持回车快速提交
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
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
