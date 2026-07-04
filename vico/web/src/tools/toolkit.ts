/**
 * Vico 平台 ToolKit — 使用 defineToolkit 统一定义前端工具 UI 渲染器。
 *
 * 这些工具的服务端执行逻辑已在 Agent 引擎中定义（通过 AI SDK streamText），
 * 此处仅注册前端的展示组件（render），使 assistant-ui 能以声明式方式
 * 为每个工具调用匹配对应的渲染卡片。
 */
import {defineToolkit} from '@assistant-ui/react';
import {WeatherToolRenderer} from './ToolUIs/weather-ui';
import {ExecToolRenderer} from './ToolUIs/exec-ui';
import {KnowledgeSearchToolRenderer} from './ToolUIs/knowledge-search-ui';

export const toolkit = defineToolkit({
  /** 天气查询 — 服务端执行，独立卡片展示 */
  'get-weather': {
    render: WeatherToolRenderer,
    display: 'standalone',
  },
  /** 命令执行 — 需用户审批，独立卡片展示（human 类型默认 standalone，无需显式 display） */
  bash: {
    render: ExecToolRenderer,
    display: 'standalone',
  },
  /** 知识库检索 — 服务端执行，独立卡片展示 */
  search_knowledge_base: {
    render: KnowledgeSearchToolRenderer,
    display: 'standalone',
  },
});
