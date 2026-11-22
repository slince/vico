/**
 * 轻应用共享类型 — 与后端 `GET /api/v1/apps*` 返回结构一一对应。
 */

/** 应用中心列表/详情中的应用摘要 */
export interface LightAppSummary {
  /** 应用 id（与目录名一致） */
  id: string;
  name: string;
  version: string;
  description: string;
  /** emoji 或相对应用目录的图片路径 */
  icon: string;
  author?: string;
  tags: string[];
  /** 是否已安装 */
  installed: boolean;
  /** 是否启用（仅已安装应用有意义） */
  enabled: boolean;
  hasFrontend: boolean;
  hasServer: boolean;
  /** 前端是否已构建（dist 入口存在） */
  frontendBuilt: boolean;
  /** 开发态前端地址 */
  devUrl?: string;
  dir: string;
  /** 清单解析/校验错误；存在时不可安装 */
  error?: string;
}
