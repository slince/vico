# React 项目最佳实践

## 核心原则

### 1. 组件拆分与文件组织

**每个组件文件不超过 200 行。** 超过该阈值时，将子组件拆分到独立文件。

```
pages-new/
├── Dashboard.tsx              # 页面壳：数据获取 + 布局编排（<150行）
├── dashboard/                 # 页面专属子组件目录
│   ├── StatCard.tsx           # 统计卡片
│   ├── TokenTrendChart.tsx    # Token 趋势图
│   ├── RecentConversations.tsx # 最近对话列表
│   └── DashboardSkeleton.tsx  # 骨架屏
```

**规则：**
- 页面组件只负责数据获取、状态管理、布局编排，不做具体 UI 渲染
- 每个可复用的 UI 片段提取为独立子组件，放在页面同级子目录下
- 子组件名称清晰表达其职责（如 `StatCard`、`AgentCard`、`CreateAgentDialog`）
- 若子组件仅被该页面使用，放在 `pages-new/<page-name>/` 下；若跨页面复用，提取到 `components/` 下

### 2. 组件职责单一

每个组件只做好一件事：

| 组件类型 | 职责 | 示例 |
|---------|------|------|
| 页面组件 | 数据获取(query/mutation)、状态管理、子组件编排 | `Dashboard.tsx` |
| 展示组件 | 纯 UI 渲染，通过 props 接收数据 | `StatCard.tsx` |
| 表单组件 | 表单状态管理、校验、提交 | `CreateAgentDialog.tsx` |
| 布局组件 | 页面结构、响应式排列 | `Layout.tsx` |
| 反馈组件 | 加载态(Skeleton)、空态(Empty)、错误态 | `AgentListSkeleton.tsx` |

### 3. 状态分层管理

```
页面组件（useQuery / useMutation）
  ├── 数据 → 通过 props 向下传递给子组件
  ├── UI 状态（dialog open/close 等）→ 页面级 useState
  └── 子组件
        ├── 纯展示：只接收 props，无内部状态
        └── 表单：内部管理表单字段状态（useState）
```

**规则：**
- 服务端数据使用 TanStack Query（`useQuery` / `useMutation`）管理
- UI 交互状态（弹窗开关、选中项等）使用 `useState`
- 子组件通过 props 接收数据，避免子组件内部发起数据请求
- 跨组件共享的状态提升到最近的共同父组件

### 4. 文件命名规范

| 类型 | 命名规则 | 示例 |
|------|---------|------|
| 页面组件 | `PascalCase.tsx` | `Dashboard.tsx`, `Agents.tsx` |
| 页面子组件 | `PascalCase.tsx` | `dashboard/StatCard.tsx` |
| 通用组件 | `kebab-case.tsx` | `components/ui/alert-dialog.tsx` |
| Hook | `use-xxx.ts` 或 `useXxx.ts` | `use-mobile.ts`, `useAuth.tsx` |
| 工具/库 | `xxx.ts` | `utils.ts`, `client.ts` |
| 类型定义 | `types.ts`（页面级共享类型） | `dashboard/types.ts` |

### 5. 状态覆盖完整

每个页面/组件必须覆盖以下四种状态：

```
                  ┌──────────────────┐
                  │   数据加载完成？   │
                  └──────┬───────────┘
                    No   │   Yes
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐        ┌──────────────┐
        │ 加载态    │        │  数据为空？    │
        │ Skeleton  │        └──────┬───────┘
        └──────────┘          Yes  │   No
                        ┌──────────┴──────────┐
                        ▼                     ▼
                  ┌──────────┐          ┌──────────┐
                  │ 空状态    │          │ 正常态    │
                  │ Empty     │          │ 数据展示   │
                  └──────────┘          └──────────┘
```

**规则：**
- **加载态**：使用 Skeleton 组件，不要用简单的 "Loading..." 文字
- **空状态**：使用 Empty 组件，提供引导性文字告诉用户下一步做什么
- **错误态**：使用 Alert 组件展示错误信息，提供重试按钮
- **正常态**：展示数据

### 6. 避免的模式

**不要在页面组件中定义子组件：**

```tsx
// ❌ 错误：子组件定义在同一个文件内，导致文件过长
export default function Dashboard() {
  // ... 200 行数据逻辑

  function StatCard({ label, value }) {  // 又占 50 行
    return <Card>...</Card>;
  }

  function TokenTrendChart({ data }) {   // 再占 40 行
    return <Card>...</Card>;
  }

  return <div>...</div>;
}
```

```tsx
// ✅ 正确：子组件拆分到独立文件
// Dashboard.tsx（约 80 行）
import { StatCard } from './dashboard/StatCard';
import { TokenTrendChart } from './dashboard/TokenTrendChart';

export default function Dashboard() {
  const { data, isLoading } = useQuery(...);

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return <ErrorPlaceholder />;

  return (
    <div>
      {statCards.map(c => <StatCard key={c.label} {...c} />)}
      <TokenTrendChart data={data.tokenTrend} />
    </div>
  );
}
```

**不要将 UI 渲染和对话框内容混在一起：**

```tsx
// ❌ 错误：弹窗内容内联在页面中
return (
  <Dialog>
    <DialogContent>
      {/* 20 行表单内容 */}
    </DialogContent>
  </Dialog>
);

// ✅ 正确：弹窗提取为独立组件
import { CreateAgentDialog } from './agents/CreateAgentDialog';

return (
  <CreateAgentDialog
    open={createOpen}
    onOpenChange={setCreateOpen}
    onSubmit={handleCreate}
  />
);
```

### 7. 类型定义管理

- 页面级专属类型定义在页面子目录的 `types.ts` 文件中
- 跨页面共享的类型定义在 `src/types/` 下
- API 返回数据的类型与后端接口保持同步，使用 interface 而非 type alias

```tsx
// pages-new/dashboard/types.ts
export interface DashboardStats {
  totalConversations: number;
  totalTokens: number;
  // ...
}

export interface StatCardConfig {
  label: string;
  getValue: (stats: DashboardStats) => string;
  icon: React.ComponentType<{ size?: number }>;
  iconColor: string;
}
```

### 8. 导入顺序规范

```tsx
// 1. React 核心
import { useState, useCallback } from 'react';

// 2. 第三方库
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

// 3. API / Hooks / Utils
import { api } from '@/api/client';
import { cn } from '@/lib/utils';

// 4. UI 组件
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';

// 5. 页面专属子组件
import { StatCard } from './dashboard/StatCard';

// 6. 类型（最后）
import type { DashboardStats } from './dashboard/types';
```

### 9. 性能优化要点

- 使用 `useCallback` 包裹传递给子组件的事件回调（避免不必要的重渲染）
- 列表渲染使用稳定的 `key`（数据库 ID，不要用 index）
- 大列表考虑虚拟滚动（本项目使用 `ScrollArea`）
- 弹窗内容使用条件渲染或 `lazy` 加载

### 10. 注释规范

遵循项目 CLAUDE.md 中的注释要求：
- 每个导出函数/组件必须有 JSDoc 注释
- 关键逻辑行添加行注释
- 类型/接口注释其职责和使用场景

### 重构示例

以当前 `Agents.tsx`（361 行）为例，重构后的文件结构：

```
pages-new/
├── Agents.tsx                   # ~80 行：数据获取 + 布局编排
├── agents/
│   ├── types.ts                 # Agent 类型定义
│   ├── AgentCard.tsx            # 单张 Agent 卡片
│   ├── AgentCardSkeleton.tsx    # 卡片骨架屏
│   ├── AgentListSkeleton.tsx    # 列表骨架屏（网格布局）
│   ├── CreateAgentDialog.tsx    # 创建 Agent 弹窗
│   ├── DeleteAgentDialog.tsx    # 删除确认弹窗
│   └── EmptyState.tsx           # 空状态提示
```

## 文件大小参考

| 文件类型 | 建议行数 | 说明 |
|---------|---------|------|
| 页面组件 | 80-150 行 | 只做编排和数据获取 |
| 子组件（展示） | 20-60 行 | 单一 UI 片段 |
| 子组件（表单/弹窗） | 60-120 行 | 含表单逻辑和校验 |
| 类型文件 | 不限 | 纯类型定义 |
| Hook 文件 | 20-80 行 | 单一逻辑关注点 |
