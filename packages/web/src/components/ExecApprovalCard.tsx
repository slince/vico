import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ExecApprovalCardProps {
  command: string;
}

/**
 * 执行审批卡片 — 在聊天中展示待审批的命令，并提供批准/拒绝按钮。
 *
 * 通过 GET /api/v1/exec-approvals/pending 查找最近一条待审批记录，
 * 然后通过 POST /api/v1/exec-approvals/:id/resolve 提交审批决定。
 */
export function ExecApprovalCard({ command }: ExecApprovalCardProps) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(false);

  /** 提交审批决定（批准或拒绝） */
  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(true);
    try {
      // 查找最近一条待处理的审批记录
      const pendingRes = await fetch('/api/v1/exec-approvals/pending');
      const pendingList = await pendingRes.json();
      const latest = pendingList[0];

      if (!latest) {
        setStatus('rejected');
        return;
      }

      const res = await fetch(`/api/v1/exec-approvals/${latest.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        setStatus(action === 'approve' ? 'approved' : 'rejected');
      }
    } catch {
      // 静默处理网络错误
    } finally {
      setLoading(false);
    }
  };

  // 已审批状态 — 显示只读结果
  if (status !== 'pending') {
    return (
      <div className="text-sm text-muted-foreground py-2">
        {status === 'approved' ? 'Command approved.' : 'Command rejected.'}
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 my-2 bg-muted/30 space-y-2">
      <div className="text-sm font-medium">Exec Approval Required</div>
      <pre className="text-xs bg-background p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all">
        {command}
      </pre>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={loading}
          onClick={() => handleAction('approve')}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => handleAction('reject')}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
