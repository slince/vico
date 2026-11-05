// @vico/types - 跨包共享的基础数据契约（零内部依赖的叶子包）

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
