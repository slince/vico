/**
 * 新建会话时「当前 Workspace」Store。
 *
 * 会话列表按工作区分组时，点击某工作区 header 的「新建」图标会预设该工作区，
 * 由 composer 的 WorkspaceSelectorAction 读取并通过 modelContext 随首消息下发；
 * 普通「新建对话」入口将其重置为 null（未分组）。用 zustand 而非 React context
 * 是因为会话列表（Sidebar）与 composer（Chat 页面）分属不同子树，需跨组件共享。
 */
import { create } from 'zustand';

interface WorkspaceSelectionState {
  /** 新建会话预设的工作区路径，null 表示未选择 */
  workspace: string | null;
  /** 更新预设工作区 */
  setWorkspace: (workspace: string | null) => void;
}

export const useWorkspaceSelection = create<WorkspaceSelectionState>((set) => ({
  workspace: null,
  setWorkspace: (workspace) => set({ workspace }),
}));
