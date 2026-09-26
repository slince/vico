# 配置模块 UI 升级 设计

> 设计日期：2026-09-25
> 范围：Settings 页升级为「左侧分组导航 + 右侧内容」壳，含三个 section：常规设置 / 用户管理 / 模型管理

## 背景与目标

Vico 当前「配置模块」只有 `vico/web/src/pages/Settings.tsx` 单页两个 Tab：

- `通用设置` — 仅语言切换
- `LLM 模型` — 模型列表 Card（增/改/删/设默认，`AddModelDialog` + `LanguageSwitcher`）

本轮把配置项换成三块，先做这三块：

1. **常规设置** — 语言（现有）+ 主题（深色 / 浅色，新增）
2. **用户管理** — 用户列表 / 添加新成员 / 删除成员（新增，需后端配套）
3. **模型管理** — 现有模型 CRUD 迁入新壳

非目标（后续再做）：记忆 / 检索(RAG) / 工具与执行 / 存储 / 系统信息等 section；模型列表不换成卡片网格；Agent 详情配置面板本轮不动（保留 Tabs）。

## 核心决策

| 项 | 决策 |
|---|---|
| 用户存储 | 复用 better-auth `user` + `account` 表，**无 schema 变更** |
| 用户密码 | 复用 `auth/seed.ts` 的 scrypt 哈希逻辑，抽取为共享 helper |
| 用户权限 | 单租户无角色，任何已登录用户可管理；守卫：不能删自己、不能删最后一个用户 |
| 主题 | 新增 ThemeProvider，切换 `<html>.dark` + localStorage；Tailwind4 `class` 策略已配好（`@custom-variant dark`） |
| 语言 | 现有 `i18n.changeLanguage()` + languagedetector，client 端，不变 |
| 前端壳 | 左侧分组导航 + 右侧内容，in-page；`/settings?section=` deep-link |
| 模型管理 | 现有 `/models` CRUD 逻辑原样迁入，列表沿用 Card 列表 |

## 数据模型

**无新增表、无迁移。**

- 用户：`db/auth-schema.ts` 的 `user`（id/name/email/username/displayUsername/createdAt）+ `account`（password 存 scrypt 哈希，providerId `credential`）。
- 语言/主题：前端 localStorage，不进 DB。

> 已知需核对项：`auth/seed.ts` 创建 account 时传了 `issuer: 'local:credential'`，但 `auth-schema.ts` 的 `account` 表没有 `issuer` 列。抽取共享 helper 时以实际 schema 为准，一并核对/修正。

## 后端

### 新增 `api/users.ts`

挂到 router，路由层规范：每个 handler 首行 `getAuthContext(c)`，不做业务逻辑，异常自然冒泡。

- `GET /api/v1/users` → 用户列表（`id`/`username`/`displayUsername`/`name`/`email`/`createdAt`），**不含** `account.password`
- `POST /api/v1/users` → 新增成员，body：`{ username, displayUsername?, name?, email, password }`
  - 校验：username/email 唯一、password 最小长度、email 格式（Zod）
  - 写 `user` + `account`（scrypt 哈希）
- `DELETE /api/v1/users/:id` → 删除成员
  - 守卫：不能删自己（`getAuthContext` 的 userId）；不能删最后一个用户（防锁死）
  - FK `onDelete: cascade` 已配，删 user 自动清 session/account

### 抽取密码 helper

`auth/seed.ts` 的 `hashPassword` + account 创建逻辑抽到 `lib/password.ts`（或 `auth/password.ts`），`seed.ts` 与 `users.ts` 复用，避免两处 scrypt 参数漂移。

## 前端

### Settings 壳（重写 `Settings.tsx`）

- 布局：左侧分组导航（分组标题 + 项 + active 态）+ 右侧内容，in-page
- 分组：本轮仅 3 项，单组平铺（常规设置 / 用户管理 / 模型管理），不设分组标题；后续 section 增多再引入多分组
- 路由：`/settings?section=general|users|models`，`useSearchParams` 同步 + deep-link

### 新增 section 组件（`vico/web/src/pages/settings/`）

- `GeneralSettings.tsx` — 语言（现有 LanguageSwitcher 逻辑）+ 主题（深色/浅色 Select 或 Toggle）
- `UserManagement.tsx` — 用户列表（表格/Card）+ 新增对话框（`AddUserDialog`）+ 删除确认（AlertDialog）
- `ModelManagement.tsx` — 现有 LLM 模型列表逻辑迁入（含 `AddModelDialog`）

### 主题 ThemeProvider（新增 `hooks/` 或 `lib/theme`）

- 切换 `<html>` 的 `.dark` class；localStorage 持久化 `theme`（`light` / `dark`）
- 默认 `light`（用户只要求深/浅两态）
- 在 `main.tsx` 包裹

### 规范遵守

- 复用 shadcn Card；用户列表处理 加载(Skeleton)/空(Empty)/错误/正常 四态
- 导入顺序 React → 第三方 → API/Hooks → UI → 子组件 → 类型
- 弹窗/表单 >60 行必拆（`AddUserDialog` 独立文件）

## 错误处理 / 测试

- `users` API 校验失败 → 4xx + 前端 toast（sonner）；唯一冲突给明确文案
- 单测：用户新增/删除守卫（不能删自己、不能删最后一个）；密码哈希 helper
- 前端走 `pnpm eval:ci` 冒烟

## 分阶段

- **Phase 1（后端）**：抽取 `hashPassword` helper + `api/users.ts`（list/create/delete + 守卫）
- **Phase 2（前端）**：ThemeProvider + Settings 壳（左侧分组导航）+ 三个 section 组件
- **后续**：记忆 / 检索(RAG) / 工具 / 存储 / 系统信息等 section（依赖运行时配置持久化，另行立项）

## 关联文档

- 架构：[docs/architecture.md](../architecture.md)
- 后端规范：[docs/ts-server-best-practices.md](../ts-server-best-practices.md)
- 前端规范：[docs/react-best-practices.md](../react-best-practices.md)
