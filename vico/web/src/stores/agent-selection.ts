/**
 * Composer 级「当前选中 Agent」Store。
 *
 * ChatProvider 不再感知 Agent，选中态下沉到聊天区 composer：AgentSelectorAction
 * 负责写入（默认 Agent / 线程对应 Agent / 用户切换），ModelSelectorAction 与
 * thread-adapter 的 initialize（预创建线程）读取。用 zustand 而非 React context
 * 是因为 initialize 在非组件上下文（adapter 闭包）里也要同步读取当前选中值。
 */
import { create } from 'zustand';
import type { Agent } from '@/types/models';

interface AgentSelectionState {
  /** 当前 composer 选中的 Agent，未选中时为 null */
  selectedAgent: Agent | null;
  /** 更新选中 Agent */
  setSelectedAgent: (agent: Agent | null) => void;
}

export const useAgentSelection = create<AgentSelectionState>((set) => ({
  selectedAgent: null,
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
}));
