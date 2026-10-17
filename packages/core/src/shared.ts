// @vico/core - 跨模块共享的纯结构类型（无内部依赖的叶子模块）

/**
 * Token 用量统计 — 单次模型调用的完整用量明细（对齐 provider V4 usage，不含 raw）。
 *
 * inputTokens 覆盖提示词 token 及缓存读写明细；outputTokens 覆盖补全 token 与推理 token。
 * 各字段可能为 undefined（provider 未上报对应明细时）。
 */
export interface UsageMetrics {
  inputTokens: {
    /** 输入（prompt）token 总数 */
    total: number | undefined;
    /** 非缓存输入 token 数 */
    noCache: number | undefined;
    /** 读取的缓存输入 token 数 */
    cacheRead: number | undefined;
    /** 写入的缓存输入 token 数 */
    cacheWrite: number | undefined;
  };
  outputTokens: {
    /** 输出（completion）token 总数 */
    total: number | undefined;
    /** 文本输出 token 数 */
    text: number | undefined;
    /** 推理（reasoning）token 数 */
    reasoning: number | undefined;
  };
}

/** 客户端工具审批决策（将 toolCallId 与审批结果绑定） */
export interface ToolCallApproval {
  toolCallId: string;
  approved: boolean;
  /** 审批作用域：turn（本 turn 有效）| session（整个 thread 有效），默认 turn */
  scope?: 'turn' | 'session';
  /** 用户随审批提交的回答（ask_user 等澄清工具），复用 tool-approval-response 的 reason 字段承载；内容为结构化 answers 的 JSON 字符串 */
  reason?: string;
}

/** 单次工具审批在 turn 内的状态记录 */
export interface ToolApproval {
  /** 工具名称 */
  toolName: string;
  /** 是否已批准 */
  approved: boolean;
  /** 批准/拒绝时间戳（Unix ms） */
  approvedAt: number;
}
