/**
 * 全局共享数据模型声明。
 *
 * 类型字段与后端 API 返回结构一一对应。
 */

/** Agent — 对应 `/api/v1/agents` 列表项，数据来自 agents 表 */
export interface Agent {
  /** 主键，UUID 字符串 */
  id: string;
  /** Agent 名称，允许中文 */
  name: string;
  /** 是否为默认 Agent（1=是，0=否），全局只有一个默认 Agent */
  is_default: number;
}

/** 会话 — 对应 `/api/v1/threads/:id` 返回 */
export interface Thread {
  /** 主键，UUID 字符串 */
  id: string;
  /** 所属 Agent ID，对应 agents 表主键 */
  agentId: string;
  /** 会话标题，首次对话后由系统自动生成 */
  title: string;
  /** 创建时间，Unix 毫秒时间戳 */
  createdAt: number;
  /** 最后更新时间，Unix 毫秒时间戳 */
  updatedAt: number;
}
