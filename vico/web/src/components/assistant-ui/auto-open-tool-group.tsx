import {ThreadGroupPart} from "@/components/assistant-ui/elements/thread.aui";
import {ToolGroupContent, ToolGroupRoot, ToolGroupTrigger} from "@/components/assistant-ui/elements/tool-group.aui";
import {ReactNode, useState} from "react";


/**
 * 工具分组容器 — 组内出现需审批（requires-action）的工具时自动展开，
 * 避免审批按钮被折叠隐藏；其余情况默认折叠，用户可手动展开。
 */
export function AutoOpenToolGroup({
  group,
  children,
}: {
  group: ThreadGroupPart;
  children: ReactNode;
}) {
  const isRequiresAction = group.status.type === "requires-action";
  const [open, setOpen] = useState(isRequiresAction);
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction);

  // 状态翻转为 requires-action 时自动展开（受控 open）
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction);
    if (isRequiresAction) setOpen(true);
  }

  return (
    <ToolGroupRoot variant="ghost" open={open} onOpenChange={setOpen}>
      <ToolGroupTrigger
        count={group.indices.length}
        active={group.status.type === "running"}
      />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}