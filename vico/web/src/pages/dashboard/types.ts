/**
 * 仪表盘子组件共享类型定义
 *
 * 包含 DashboardStats 数据结构和 StatCardConfig 配置类型。
 */

/**
 * 仪表盘统计数据接口
 *
 * 对应后端 /api/v1/dashboard/stats 接口返回的数据结构。
 */
export interface DashboardStats {
  /** 历史总线程数 */
  totalThreads: number;
  /** 所有对话累计消耗的 Token 总量 */
  totalTokens: number;
  /** 当前处于活跃状态的 Agent 数量 */
  activeAgents: number;
  /** 系统中已创建的 Agent 总数 */
  totalAgents: number;
  /** 已安装的 Skill 插件数量 */
  installedSkills: number;
  /** 已创建的知识库数量 */
  totalKnowledgeBases: number;
  /** 最近线程列表 */
  recentThreads: Array<{
    id: string;
    title: string;
    agent_name?: string;
    /** 最后一条消息预览 */
    last_message?: string;
    message_count: number;
    updated_at: number;
  }>;
  /** Token 消耗每日趋势（近30天） */
  tokenTrend: Array<{
    day: string;
    total: number;
  }>;
}

/**
 * 统计卡片配置项
 *
 * 定义每张统计卡片要展示的元数据，包括图标、标签、颜色等。
 */
export interface StatCardConfig {
  /** 卡片显示标签 */
  label: string;
  /** 从 DashboardStats 提取值的函数 */
  getValue: (stats: DashboardStats) => string;
  /** lucide-react 图标组件 */
  icon: React.ComponentType<{ size?: number }>;
  /** 图标容器的 Tailwind 颜色类名 */
  iconColor: string;
}
