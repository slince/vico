# React 项目最佳实践

## 核心原则

### 1. 组件拆分：按可理解性拆分，而非死限

行数不是绝对标准，关键在于**一个文件能否在几分钟内被完整理解**。

**拆分信号（满足任一就拆）：**

| 信号 | 说明 |
|------|------|
| 文件超过 400 行 | 几乎一定有可独立的子模块 |
| 页面同时包含数据获取 + 表单交互 + 长列表渲染 | 关注点混杂 |
| 一个弹窗/表单逻辑超过 60 行 | 提取为独立子组件 |
| 同一模式出现 3 次以上 | 提取为可复用组件 |

**不拆的情况：**

- 子组件只有 20-30 行且只在一处使用 — 放同文件比多一个 import 跳转更清晰
- 页面本身逻辑简单（如 Login 130 行）— 拆了反而碎片化
- 骨架屏和其对应组件耦合紧密 — 同文件放 export default 下方即可

```
pages-new/
├── Dashboard.tsx                 # 页面壳：数据获取 + 编排（200-300 行可接受）
├── dashboard/                    # 仅当子组件>3 个或单个>60 行时创建子目录
│   ├── StatCard.tsx
│   └── TokenTrendChart.tsx
├── AgentDetail.tsx               # 复杂页面，应拆分（当前 796 行超标）
├── agent-detail/                 # 拆分目标
│   ├── ConfigPanel.tsx           # 配置 Tab 内容
│   ├── ChatPanel.tsx             # 测试对话 Tab 内容
│   └── types.ts
```

**规则：**

- 页面组件负责数据获取、mutation、UI 状态管理、子组件编排
- 子组件通过 props 接收数据，不内部发起请求
- 子组件名称清晰表达职责（`StatCard`、`ConfigPanel`、`ChatPanel`）
- 仅当前页面使用的子组件放在 `pages-new/<page>/` 下；跨页面复用的提取到 `components/`

### 2. 组件职责单一

每个组件只做好一件事：

| 组件类型 | 职责 | 示例 |
|---------|------|------|
| 页面组件 | 数据获取(query/mutation)、状态管理、子组件编排 | `Dashboard.tsx` |
| 展示组件 | 纯 UI 渲染，通过 props 接收数据 | `StatCard.tsx` |
| 表单/弹窗组件 | 表单状态管理、校验、提交 | `CreateAgentDialog.tsx` |
| 反馈组件 | 加载态(Skeleton)、空态(Empty)、错误态 | `DashboardSkeleton.tsx` |

### 3. 状态分层管理

```
页面组件（useQuery / useMutation）
  ├── 数据 → 通过 props 向下传递给子组件
  ├── UI 状态（dialog open/close 等）→ 页面级 useState
  └── 子组件
        ├── 纯展示：只接收 props，无内部状态
        └── 表单：内部管理表单字段状态（useState）
```

- 服务端数据使用 TanStack Query（`useQuery` / `useMutation`）管理
- UI 交互状态（弹窗开关、选中项等）使用 `useState`
- 跨组件共享的状态提升到最近的共同父组件

### 4. 状态覆盖完整

每个数据驱动的页面/组件必须覆盖四种状态：

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

- **加载态**：使用 Skeleton 组件，不用"Loading..."文字
- **空状态**：使用 Empty 组件 + 引导文字告诉用户下一步做什么
- **错误态**：展示错误信息 + 返回/重试入口
- **正常态**：展示数据

### 5. 删除确认：统一使用 AlertDialog

所有删除操作必须通过 shadcn `<AlertDialog>` 二次确认，**禁止使用 `window.confirm()`**。

### 6. 防抖提交：避免每次按键触发请求

文本输入、滑块等高频 onChange 场景，使用防抖（300ms）或 `onValueCommit`（滑块专用）提交：

```tsx
// ✅ 方式一：防抖（文本输入）
const [localValue, setLocalValue] = useState<string>();

useEffect(() => {
  if (localValue === undefined) return;
  const timer = setTimeout(() => mutation.mutate({ value: localValue }), 300);
  return () => clearTimeout(timer);
}, [localValue]);

<Textarea value={localValue} onChange={(e) => setLocalValue(e.target.value)} />

// ✅ 方式二：onValueCommit（滑块，仅在释放时触发）
<Slider value={[val]} onValueCommit={([v]) => mutation.mutate({ value: v })} />
```

## 避免的模式

### 不要将复杂弹窗内联在页面中

```tsx
// ❌ 弹窗内容 20+ 行直接写在页面 JSX 里
return (
  <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent>
      {/* 20-50 行表单 JSX */}
    </DialogContent>
  </Dialog>
);

// ✅ 弹窗逻辑超过 60 行或跨页面复用时提取子组件
import { CreateAgentDialog } from './agents/CreateAgentDialog';

return <CreateAgentDialog open={open} onOpenChange={setOpen} />;

// ✅ 简单弹窗（<30 行）内联也可以接受
```

### 不要用 any 类型

```tsx
// ❌
catch (err: any) { ... }

// ✅
catch (err: unknown) {
  setError(err instanceof Error ? err.message : '未知错误');
}
```

### 不要用非空断言

```tsx
// ❌
const stats = data!;

// ✅
if (!data) return <ErrorFallback />;
const stats = data;
```

## 类型定义管理

- 页面级 interface 优先定义在页面文件顶部；超过 5 个或跨页面共享时提取到 `types.ts`
- 跨页面共享的类型放 `src/types/`
- 使用 `interface` 而非 `type alias`
- 禁用 `any`，必要时用 `unknown` + 类型守卫

## 导入顺序

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
import { Card } from '@/components/ui/card';

// 5. 页面子组件
import { StatCard } from './dashboard/StatCard';

// 6. 类型
import type { DashboardStats } from './dashboard/types';
```

## 性能要点

- 传递给子组件的事件回调使用 `useCallback` 包裹
- 列表渲染使用稳定的 `key`（数据库 ID，不用 index）
- pending/loading 状态应精准到具体操作的条目，不要全局禁用所有按钮

## 文件命名

| 类型 | 命名 | 示例 |
|------|------|------|
| 页面组件 | `PascalCase.tsx` | `Dashboard.tsx` |
| 页面子组件 | `PascalCase.tsx` | `dashboard/StatCard.tsx` |
| 通用 UI 组件 | `kebab-case.tsx` | `components/ui/alert-dialog.tsx` |
| Hook | `useXxx.ts` | `useAuth.ts` |
| 类型 | `types.ts` | `agent-detail/types.ts` |
