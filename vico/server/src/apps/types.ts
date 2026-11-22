/**
 * 轻应用托管类型定义。
 *
 * 轻应用 = 一个带 `app.json` 清单的本地目录，可选包含：
 * - 前端：Vite 构建产物（默认 `dist/`），由 vico 静态托管在 `/app-static/<id>/`
 * - 后端：一个 ESM 模块，导出 `setup(subApp, ctx)`，由 vico 挂载到 `/api/apps/<id>/`
 *
 * 应用后端与 vico 同进程运行（可信本地应用），数据库（如 SQLite）完全由应用自行
 * 管理，vico 只保证提供独立且持久的 `ctx.dataDir`。
 */
import type { Hono } from 'hono';
import type { Logger } from 'pino';

/** 应用清单 `app.json` 的字段定义（解析后均补齐默认值） */
export interface LightAppManifest {
  /** 应用唯一标识，必须与目录名一致，用于 URL 路径 */
  id: string;
  /** 展示名称 */
  name: string;
  /** 版本号（可选，纯展示） */
  version?: string;
  /** 一句话描述 */
  description?: string;
  /** 图标：emoji 或相对应用目录的图片路径 */
  icon?: string;
  /** 作者 */
  author?: string;
  /** 标签 */
  tags?: string[];
  /** 前端配置：构建产物目录与入口文件 */
  frontend?: {
    dist?: string;
    entry?: string;
  };
  /** 后端配置：模块入口（相对应用目录） */
  server?: {
    entry?: string;
  };
  /** 开发态配置：应用自身 vite dev server 地址（可选） */
  dev?: {
    url?: string;
  };
}

/** 应用中心列表/详情返回的应用摘要 */
export interface LightAppSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  author?: string;
  tags: string[];
  /** 是否已安装 */
  installed: boolean;
  /** 是否启用（安装后默认启用；禁用会停止路由注入与前端访问） */
  enabled: boolean;
  /** 是否包含前端构建产物 */
  hasFrontend: boolean;
  /** 是否声明后端入口 */
  hasServer: boolean;
  /** 前端是否已构建（dist 入口文件存在） */
  frontendBuilt: boolean;
  /** 开发态前端地址（存在且未构建时前端页面可回退到该地址） */
  devUrl?: string;
  /** 应用所在目录（绝对路径，仅服务端/管理员可见） */
  dir: string;
  /** 清单解析/校验错误；存在时该应用不可安装 */
  error?: string;
}

/** 应用后端 setup 函数可用的上下文 */
export interface AppServerContext {
  /** 应用 id（与目录名一致） */
  appId: string;
  /** 应用私有数据目录（已创建，绝对路径），应用可在此存放 SQLite 等文件 */
  dataDir: string;
  /** vico 日志器，带 appId 绑定字段 */
  logger: Logger;
}

/** 应用后端模块的形状：默认导出（或具名 `setup`）的挂载函数 */
export type AppServerSetup = (app: Hono, ctx: AppServerContext) => void | Promise<void>;
