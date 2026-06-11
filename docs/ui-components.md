# UI 组件文档

> 路径: `packages/web/src/components/ui/`  
> 入口: `packages/web/src/components/ui/index.tsx`（barrel export）  
> 基于 [shadcn](https://ui.shadcn.com/) 体系，使用 [radix-rhea](https://github.com/shadcn/rhea) 风格变体

## 技术栈

| 类别 | 技术 |
|---|---|
| 框架 | React 19 |
| 构建 | Vite 6 |
| 语言 | TypeScript 5.6 |
| 样式 | Tailwind CSS v4 + tw-animate-css + tailwind-merge + clsx |
| 变体系统 | class-variance-authority (CVA) |
| 图标 | lucide-react |
| 图表 | recharts |
| 轮播 | embla-carousel-react |
| 日期选择 | react-day-picker v10 + date-fns |
| OTP 输入 | input-otp |
| 通知 | sonner |
| 主题 | next-themes |
| 路由 | react-router-dom v7 |

## UI 基础库

| 库 | 用途 |
|---|---|
| radix-ui | Accordion, AlertDialog, Avatar, Checkbox, Collapsible, ContextMenu, Dialog, Direction, DropdownMenu, HoverCard, Label, Menubar, NavigationMenu, Popover, Progress, RadioGroup, ScrollArea, Select, Separator, Slider, Switch, Tabs, Toggle, ToggleGroup, Tooltip |
| @base-ui/react | Combobox |
| cmdk | Command (命令面板) |
| vaul | Drawer (抽屉) |
| react-resizable-panels | Resizable (可调整面板) |

---

## 组件清单（共 56 个组件组，200+ 导出）

### 1. Accordion — 手风琴

**文件:** `accordion.tsx`  
**基础库:** radix-ui (Accordion)

| 导出 | 说明 |
|---|---|
| `Accordion` | 根容器，圆角 2xl，垂直堆叠 |
| `AccordionItem` | 单个折叠项，非最后项有底部边框，展开时 bg-muted/50 |
| `AccordionTrigger` | 点击标题栏，收起时显示 ChevronDownIcon，展开时显示 ChevronUpIcon |
| `AccordionContent` | 展开的内容区域，带动画 |

---

### 2. Alert — 提示

**文件:** `alert.tsx`

| 导出 | 说明 |
|---|---|
| `Alert` | 根容器，`variant: "default" \| "destructive"` |
| `AlertTitle` | 标题，中等字重 |
| `AlertDescription` | 描述文字，muted-foreground |
| `AlertAction` | 右上角操作区域，绝对定位 |

内部导出（不在 barrel 中）: `alertVariants`

---

### 3. AlertDialog — 警告对话框

**文件:** `alert-dialog.tsx`  
**基础库:** radix-ui (AlertDialog)

| 导出 | 说明 |
|---|---|
| `AlertDialog` | 根组件 |
| `AlertDialogTrigger` | 打开触发器 |
| `AlertDialogContent` | 对话框面板，`size: "default" \| "sm"` 控制最大宽度 |
| `AlertDialogHeader` | 头部，grid 布局 |
| `AlertDialogFooter` | 底部操作区 |
| `AlertDialogTitle` | 标题，font-heading |
| `AlertDialogDescription` | 描述文字 |
| `AlertDialogAction` | 操作按钮（渲染为 Button） |
| `AlertDialogCancel` | 取消按钮（渲染为 outline Button） |

内部导出: `AlertDialogMedia`, `AlertDialogOverlay`, `AlertDialogPortal`

---

### 4. AspectRatio — 宽高比

**文件:** `aspect-ratio.tsx`  
**基础库:** radix-ui (AspectRatio)

| 导出 | 说明 |
|---|---|
| `AspectRatio` | 保持子元素宽高比的容器 |

---

### 5. Avatar — 头像

**文件:** `avatar.tsx`  
**基础库:** radix-ui (Avatar)

| 导出 | 说明 |
|---|---|
| `Avatar` | 圆形头像容器，`size: "default" \| "sm" \| "lg"`（8/6/10） |
| `AvatarImage` | 头像图片 |
| `AvatarFallback` | 图片加载失败时的回退（首字母等） |

内部导出: `AvatarGroup`, `AvatarGroupCount`, `AvatarBadge`

---

### 6. Badge — 徽章

**文件:** `badge.tsx`

| 导出 | 说明 |
|---|---|
| `Badge` | 内联标签，`variant: "default" \| "secondary" \| "destructive" \| "outline" \| "ghost" \| "link"`，支持 `asChild` |
| `badgeVariants` | CVA 变体配置 |

---

### 7. Breadcrumb — 面包屑

**文件:** `breadcrumb.tsx`

| 导出 | 说明 |
|---|---|
| `Breadcrumb` | 根 `<nav>`，aria-label="breadcrumb" |
| `BreadcrumbList` | 有序列表 `<ol>` |
| `BreadcrumbItem` | 单个面包屑项 `<li>` |
| `BreadcrumbLink` | 链接，支持 `asChild` |
| `BreadcrumbPage` | 当前页面（不可点击），aria-current="page" |
| `BreadcrumbSeparator` | 分隔符（默认 ChevronRightIcon） |
| `BreadcrumbEllipsis` | 折叠省略号（MoreHorizontalIcon） |

---

### 8. Button — 按钮

**文件:** `button.tsx`

| 导出 | 说明 |
|---|---|
| `Button` | 核心按钮组件，变体: `"default" \| "outline" \| "secondary" \| "ghost" \| "destructive" \| "link"`，尺寸: `"default" \| "xs" \| "sm" \| "lg" \| "icon" \| "icon-xs" \| "icon-sm" \| "icon-lg"`，支持 `asChild` |
| `buttonVariants` | CVA 变体配置 |

---

### 9. ButtonGroup — 按钮组

**文件:** `button-group.tsx`

| 导出 | 说明 |
|---|---|
| `ButtonGroup` | 按钮组容器，`orientation: "horizontal" \| "vertical"`，视觉上连接相邻按钮 |
| `ButtonGroupText` | 按钮组中的文本段（如标签），支持 `asChild` |

内部导出: `ButtonGroupSeparator`, `buttonGroupVariants`

---

### 10. Calendar — 日历

**文件:** `calendar.tsx`  
**基础库:** react-day-picker v10

| 导出 | 说明 |
|---|---|
| `Calendar` | 日期选择日历，支持 `buttonVariant`, `captionLayout: "label" \| "dropdown"`, `locale`, `formatters` |
| `CalendarDayButton` | 单个日期按钮，管理焦点状态和数据属性 |

---

### 11. Card — 卡片

**文件:** `card.tsx`

| 导出 | 说明 |
|---|---|
| `Card` | 卡片容器，`size: "default" \| "sm"`，带圆角、阴影、环形边框 |
| `CardHeader` | 头部，grid 布局 |
| `CardTitle` | 标题，font-heading |
| `CardDescription` | 描述文字 |
| `CardContent` | 主体内容区 |
| `CardFooter` | 底部区域 |

内部导出: `CardAction`

---

### 12. Carousel — 轮播

**文件:** `carousel.tsx`  
**基础库:** embla-carousel-react

| 导出 | 说明 |
|---|---|
| `Carousel` | 轮播根组件，`opts`, `plugins`, `orientation`, `setApi` |
| `CarouselContent` | 可滚动内部容器 |
| `CarouselItem` | 单个幻灯片 |
| `CarouselPrevious` | 上一张按钮，到起点时禁用 |
| `CarouselNext` | 下一张按钮，到终点时禁用 |

内部导出: `useCarousel` (hook), `CarouselApi` (type)

---

### 13. Chart — 图表

**文件:** `chart.tsx`  
**基础库:** recharts

| 导出 | 说明 |
|---|---|
| `ChartContainer` | 图表容器，`config: ChartConfig`，包裹 ResponsiveContainer，生成 CSS 变量 |
| `ChartStyle` | 注入 `<style>` 标签，包含图表颜色 CSS 自定义属性 |
| `ChartTooltip` | Recharts Tooltip 的重新导出 |
| `ChartTooltipContent` | 自定义 tooltip 内容，`indicator: "line" \| "dot" \| "dashed"`, `hideLabel`, `hideIndicator` 等 |
| `ChartLegend` | Recharts Legend 的重新导出 |
| `ChartLegendContent` | 自定义图例内容，`hideIcon`, `nameKey`, `verticalAlign` |
| `ChartConfig` (type) | 图表系列配置类型：`Record<string, { label?, icon?, color? \| theme? }>` |

---

### 14. Checkbox — 复选框

**文件:** `checkbox.tsx`  
**基础库:** radix-ui (Checkbox)

| 导出 | 说明 |
|---|---|
| `Checkbox` | 样式化复选框，选中时显示 CheckIcon，支持 focus-visible 环和无效状态 |

---

### 15. Collapsible — 折叠

**文件:** `collapsible.tsx`  
**基础库:** radix-ui (Collapsible)

| 导出 | 说明 |
|---|---|
| `Collapsible` | 根组件 |
| `CollapsibleTrigger` | 触发按钮 |
| `CollapsibleContent` | 折叠内容 |

---

### 16. Combobox — 组合框

**文件:** `combobox.tsx`  
**基础库:** @base-ui/react (Combobox)

| 导出 | 说明 |
|---|---|
| `Combobox` | 根组件 |
| `ComboboxValue` | 显示选中的值 |
| `ComboboxTrigger` | 下拉触发器，带 chevron 图标 |
| `ComboboxInput` | 文本输入，包裹在 InputGroup 中，可选 `showTrigger`, `showClear`, `disabled` |
| `ComboboxContent` | 下拉弹窗，`side`, `sideOffset`, `align`, `alignOffset`, `anchor` |
| `ComboboxList` | 可滚动选项列表 |
| `ComboboxItem` | 单个可选项，带勾选指示器 |
| `ComboboxGroup` | 选项分组 |
| `ComboboxLabel` | 分组标签 |
| `ComboboxCollection` | 从集合渲染选项 |
| `ComboboxEmpty` | 无结果时显示 |
| `ComboboxSeparator` | 分隔线 |
| `ComboboxChips` | 多选模式下已选项目容器 |
| `ComboboxChip` | 单个已选标签，`showRemove` 控制是否显示 X 删除按钮 |
| `ComboboxChipsInput` | 标签容器内的文本输入 |

内部导出: `ComboboxClear`, `useComboboxAnchor` (hook)

---

### 17. Command — 命令面板

**文件:** `command.tsx`  
**基础库:** cmdk

| 导出 | 说明 |
|---|---|
| `Command` | 根组件，圆角 3xl，bg-popover |
| `CommandDialog` | 在 Dialog 中包裹 Command，`title`, `description`, `showCloseButton` |
| `CommandInput` | 搜索输入，包裹在 InputGroup 中，带搜索图标 |
| `CommandList` | 可滚动列表（max-h-72） |
| `CommandEmpty` | 无结果时显示 |
| `CommandGroup` | 命令分组 |
| `CommandSeparator` | 分隔线 |
| `CommandItem` | 单个命令项，选中时显示勾选标记 |
| `CommandShortcut` | 快捷键徽章，tracking-widest |

---

### 18. ContextMenu — 右键菜单

**文件:** `context-menu.tsx`  
**基础库:** radix-ui (ContextMenu)

| 导出 | 说明 |
|---|---|
| `ContextMenu` | 根组件 |
| `ContextMenuTrigger` | 触发右键菜单的元素 |
| `ContextMenuContent` | 下拉面板，`side` |
| `ContextMenuGroup` | 选项分组 |
| `ContextMenuItem` | 菜单项，`inset`, `variant: "default" \| "destructive"` |
| `ContextMenuSub` | 子菜单 |
| `ContextMenuSubTrigger` | 子菜单触发器，`inset`，显示 ChevronRightIcon |
| `ContextMenuSubContent` | 子菜单面板 |
| `ContextMenuCheckboxItem` | 可勾选菜单项，`inset` |
| `ContextMenuRadioGroup` | 单选组 |
| `ContextMenuRadioItem` | 单选菜单项，`inset` |
| `ContextMenuLabel` | 不可交互标签，`inset` |
| `ContextMenuSeparator` | 分隔线 |
| `ContextMenuShortcut` | 快捷键徽章 |

---

### 19. DatePicker — 日期选择器（示例）

**文件:** `date-picker.tsx`

| 导出 | 说明 |
|---|---|
| `DatePickerDemo` | 示例日期选择器，Button + Popover + Calendar，单选模式。**不在 barrel 导出中** |

---

### 20. Dialog — 对话框

**文件:** `dialog.tsx`  
**基础库:** radix-ui (Dialog)

| 导出 | 说明 |
|---|---|
| `Dialog` | 根组件 |
| `DialogTrigger` | 打开按钮 |
| `DialogClose` | 关闭触发器 |
| `DialogOverlay` | 半透明黑色遮罩 |
| `DialogContent` | 居中模态面板，`showCloseButton`（默认 true） |
| `DialogHeader` | 头部（flex-col, gap-1.5） |
| `DialogFooter` | 底部操作区，`showCloseButton`（默认 false） |
| `DialogTitle` | 标题，font-heading |
| `DialogDescription` | 描述文字 |

内部导出: `DialogPortal`

---

### 21. Direction — 文本方向（RTL 支持）

**文件:** `direction.tsx`  
**基础库:** radix-ui (Direction)

| 导出 | 说明 |
|---|---|
| `DirectionProvider` | 设置文本方向（LTR/RTL），`dir` 或 `direction` prop |
| `useDirection` | 获取当前方向上下文的 hook |

---

### 22. Drawer — 抽屉

**文件:** `drawer.tsx`  
**基础库:** vaul

| 导出 | 说明 |
|---|---|
| `Drawer` | 根组件 |
| `DrawerTrigger` | 打开按钮 |
| `DrawerClose` | 关闭触发器 |
| `DrawerOverlay` | 遮罩 |
| `DrawerContent` | 滑出面板，支持 bottom/left/right/top 方向 |
| `DrawerHeader` | 头部 |
| `DrawerFooter` | 底部（mt-auto） |
| `DrawerTitle` | 标题，font-heading |
| `DrawerDescription` | 描述文字 |

---

### 23. DropdownMenu — 下拉菜单

**文件:** `dropdown-menu.tsx`  
**基础库:** radix-ui (DropdownMenu)

| 导出 | 说明 |
|---|---|
| `DropdownMenu` | 根组件 |
| `DropdownMenuTrigger` | 触发按钮 |
| `DropdownMenuContent` | 下拉面板，`align`, `sideOffset` |
| `DropdownMenuGroup` | 选项分组 |
| `DropdownMenuItem` | 菜单项，`inset`, `variant: "default" \| "destructive"` |
| `DropdownMenuCheckboxItem` | 可勾选菜单项，`inset` |
| `DropdownMenuRadioGroup` | 单选组 |
| `DropdownMenuRadioItem` | 单选菜单项，`inset` |
| `DropdownMenuLabel` | 不可交互标签，`inset` |
| `DropdownMenuSeparator` | 分隔线 |
| `DropdownMenuShortcut` | 快捷键徽章 |
| `DropdownMenuSub` | 子菜单 |
| `DropdownMenuSubTrigger` | 子菜单触发器，`inset`，显示 ChevronRightIcon |
| `DropdownMenuSubContent` | 子菜单面板 |

---

### 24. Empty — 空状态

**文件:** `empty.tsx`

| 导出 | 说明 |
|---|---|
| `Empty` | 根容器，居中，虚线边框 |
| `EmptyHeader` | 头部包装（max-w-sm, flex-col cent） |
| `EmptyMedia` | 图标/媒体区域，`variant: "default" \| "icon"` |
| `EmptyTitle` | 标题文字，font-heading，text-lg |
| `EmptyDescription` | 描述文字，muted |
| `EmptyContent` | 内容包装器，用于标题/描述下方的其他元素 |

---

### 25. Field — 表单字段

**文件:** `field.tsx`

| 导出 | 说明 |
|---|---|
| `FieldSet` | `<fieldset>` 分组，gap-6 |
| `FieldLegend` | fieldset 的 `<legend>`，`variant: "legend" \| "label"` |
| `FieldGroup` | 字段组容器，使用 `@container` 查询 |
| `Field` | 单个表单字段，`orientation: "vertical" \| "horizontal" \| "responsive"`（responsive 在移动端堆叠，宽屏并排） |
| `FieldContent` | 字段控件的内容包装器（flex-1, flex-col） |
| `FieldLabel` | 使用 Label 组件，禁用时调整样式 |
| `FieldTitle` | 非输入字段的标题 |
| `FieldDescription` | 描述/帮助文字，支持链接 |
| `FieldSeparator` | 字段之间的分隔符，可选居中文字内容 |
| `FieldError` | 显示验证错误消息，`errors: Array<{ message?: string }>`，自动去重 |

---

### 26. HoverCard — 悬停卡片

**文件:** `hover-card.tsx`  
**基础库:** radix-ui (HoverCard)

| 导出 | 说明 |
|---|---|
| `HoverCard` | 根组件 |
| `HoverCardTrigger` | 悬停目标 |
| `HoverCardContent` | 浮动卡片，`align`, `sideOffset`，w-72，圆角 3xl |

---

### 27. Input — 输入框

**文件:** `input.tsx`

| 导出 | 说明 |
|---|---|
| `Input` | 样式化 `<input>`，h-8，圆角 2xl，bg-input/50，支持文件输入样式、placeholder、focus 环、无效状态和禁用状态 |

---

### 28. InputGroup — 输入框组

**文件:** `input-group.tsx`

| 导出 | 说明 |
|---|---|
| `InputGroup` | 输入框与附加元素（图标、按钮、文字）的组合容器，管理内部控件的 focus 环 |
| `InputGroupAddon` | 附加元素，`align: "inline-start" \| "inline-end" \| "block-start" \| "block-end"`，点击附加元素会聚焦输入框 |
| `InputGroupButton` | 输入框组内的按钮，`size: "xs" \| "sm" \| "icon-xs" \| "icon-sm"`, `variant` |
| `InputGroupText` | 输入框组附加元素中的文本内容 |
| `InputGroupInput` | InputGroup 专用的 Input 变体（无边框、无阴影、无 focus 环） |
| `InputGroupTextarea` | InputGroup 专用的 Textarea 变体（无边框、无阴影、无 focus 环） |

---

### 29. InputOTP — OTP 输入

**文件:** `input-otp.tsx`  
**基础库:** input-otp

| 导出 | 说明 |
|---|---|
| `InputOTP` | OTP 输入根组件，`containerClassName` |
| `InputOTPGroup` | OTP 槽位分组，支持无效状态样式 |
| `InputOTPSlot` | 单个字符槽位，`index: number`，激活时显示假光标动画 |
| `InputOTPSeparator` | 槽位组之间的分隔符（MinusIcon） |

---

### 30. Item — 列表项

**文件:** `item.tsx`

| 导出 | 说明 |
|---|---|
| `ItemGroup` | 列表容器（role="list"），根据 item 尺寸调整间距 |
| `ItemSeparator` | 项目之间的分隔符（水平，my-2） |
| `Item` | 单个列表项，`variant: "default" \| "outline" \| "muted"`, `size: "default" \| "sm" \| "xs"`，支持 `asChild` |
| `ItemMedia` | 媒体区域，`variant: "default" \| "icon" \| "image"` |
| `ItemContent` | 主内容区域（flex-1, flex-col） |
| `ItemTitle` | 标题（line-clamp-1，中等字重） |
| `ItemDescription` | 描述（line-clamp-2，muted） |
| `ItemActions` | 操作按钮区域（右对齐） |
| `ItemHeader` | 全宽头部行（basis-full, space-between） |
| `ItemFooter` | 全宽底部行（basis-full, space-between） |

---

### 31. Kbd — 键盘按键

**文件:** `kbd.tsx`

| 导出 | 说明 |
|---|---|
| `Kbd` | 键盘按键徽章（inline-flex, 圆角 lg, bg-muted, text-xs），在 InputGroup 或 Tooltip 内自动调整样式 |
| `KbdGroup` | 多个 Kbd 元素的分组（inline-flex, gap-1） |

---

### 32. Label — 标签

**文件:** `label.tsx`  
**基础库:** radix-ui (Label)

| 导出 | 说明 |
|---|---|
| `Label` | 表单标签，flex row，gap-2，中等字重，支持 disabled/peer-disabled 样式 |

---

### 33. Menubar — 菜单栏

**文件:** `menubar.tsx`  
**基础库:** radix-ui (Menubar)

| 导出 | 说明 |
|---|---|
| `Menubar` | 菜单栏容器（flex, h-8, 圆角 2xl, 边框） |
| `MenubarMenu` | 菜单栏中的单个菜单 |
| `MenubarGroup` | 选项分组 |
| `MenubarTrigger` | 菜单触发器（hover/展开时 bg-muted） |
| `MenubarContent` | 下拉面板，`align`, `alignOffset`, `sideOffset` |
| `MenubarItem` | 菜单项，`inset`, `variant: "default" \| "destructive"` |
| `MenubarCheckboxItem` | 可勾选菜单项，`inset` |
| `MenubarRadioItem` | 单选菜单项，`inset`，勾选标记在左侧 |
| `MenubarLabel` | 不可交互标签，`inset` |
| `MenubarSeparator` | 分隔线 |
| `MenubarShortcut` | 快捷键徽章 |
| `MenubarSub` | 子菜单 |
| `MenubarSubTrigger` | 子菜单触发器，`inset`，显示 ChevronRightIcon |
| `MenubarSubContent` | 子菜单面板 |

---

### 34. NativeSelect — 原生选择框

**文件:** `native-select.tsx`

| 导出 | 说明 |
|---|---|
| `NativeSelect` | 样式化原生 `<select>`，`size: "sm" \| "default"`，覆盖原生下拉箭头，显示 ChevronDownIcon |
| `NativeSelectOption` | 样式化 `<option>` |
| `NativeSelectOptGroup` | 样式化 `<optgroup>` |

---

### 35. NavigationMenu — 导航菜单

**文件:** `navigation-menu.tsx`  
**基础库:** radix-ui (NavigationMenu)

| 导出 | 说明 |
|---|---|
| `NavigationMenu` | 根组件，`viewport`（默认 true），自动渲染 NavigationMenuViewport |
| `NavigationMenuList` | 水平菜单项列表 |
| `NavigationMenuItem` | 单个菜单项包装器 |
| `NavigationMenuTrigger` | 触发按钮，带旋转 chevron |
| `NavigationMenuContent` | 下拉内容面板，两种模式：使用 Viewport 或独立 popover（`viewport=false`） |
| `NavigationMenuViewport` | 所有内容面板的共享视口，位于菜单下方，带动画 |
| `NavigationMenuLink` | 导航链接，hover/focus/active 状态 |
| `NavigationMenuIndicator` | 活动触发器下方的动画箭头指示器 |

内部导出: `navigationMenuTriggerStyle`

---

### 36. Pagination — 分页

**文件:** `pagination.tsx`

| 导出 | 说明 |
|---|---|
| `Pagination` | 根 `<nav>`，aria-label="pagination" |
| `PaginationContent` | 页码列表 `<ul>`（flex, gap-1） |
| `PaginationItem` | 单个页码项 `<li>` |
| `PaginationLink` | 页码链接，`isActive`, `size`，包裹 `<a>` 在 Button 中 |
| `PaginationPrevious` | 上一页，`text`（默认 "Previous"），带 ChevronLeftIcon |
| `PaginationNext` | 下一页，`text`（默认 "Next"），带 ChevronRightIcon |
| `PaginationEllipsis` | 省略号指示器，MoreHorizontalIcon |

---

### 37. Popover — 弹出框

**文件:** `popover.tsx`  
**基础库:** radix-ui (Popover)

| 导出 | 说明 |
|---|---|
| `Popover` | 根组件 |
| `PopoverTrigger` | 触发按钮 |
| `PopoverContent` | 浮动面板，`align`, `sideOffset`，w-72，圆角 3xl |
| `PopoverAnchor` | 锚点引用 |

内部导出: `PopoverHeader`, `PopoverTitle`, `PopoverDescription`

---

### 38. Progress — 进度条

**文件:** `progress.tsx`  
**基础库:** radix-ui (Progress)

| 导出 | 说明 |
|---|---|
| `Progress` | 水平进度条，`value?: number`（0-100），h-2，圆角 2xl，指示器根据值平移 |

---

### 39. RadioGroup — 单选组

**文件:** `radio-group.tsx`  
**基础库:** radix-ui (RadioGroup)

| 导出 | 说明 |
|---|---|
| `RadioGroup` | 单选组容器（grid, gap-3） |
| `RadioGroupItem` | 单个单选按钮（size-4，圆角 2xl），选中时显示实心圆 |

---

### 40. Resizable — 可调整面板

**文件:** `resizable.tsx`  
**基础库:** react-resizable-panels

| 导出 | 说明 |
|---|---|
| `ResizablePanelGroup` | 可调整面板组（flex 容器） |
| `ResizablePanel` | 单个可调整面板 |
| `ResizableHandle` | 面板之间的拖拽手柄，`withHandle` 控制是否显示视觉手柄指示器 |

---

### 41. ScrollArea — 滚动区域

**文件:** `scroll-area.tsx`  
**基础库:** radix-ui (ScrollArea)

| 导出 | 说明 |
|---|---|
| `ScrollArea` | 可滚动容器，包含 Viewport、ScrollBar 和 Corner，Viewport 有 focus-visible 环 |
| `ScrollBar` | 滚动条，`orientation: "vertical" \| "horizontal"`，带圆角滑块 |

---

### 42. Select — 选择框

**文件:** `select.tsx`  
**基础库:** radix-ui (Select)

| 导出 | 说明 |
|---|---|
| `Select` | 根组件 |
| `SelectGroup` | 选项分组 |
| `SelectValue` | 显示选中的值 |
| `SelectTrigger` | 选择框触发器，`size: "sm" \| "default"`，带 ChevronDownIcon |
| `SelectContent` | 下拉面板，`position: "popper" \| "item-aligned"`, `align` |
| `SelectLabel` | 分组标签 |
| `SelectItem` | 单个选项，带 CheckIcon 指示器 |
| `SelectSeparator` | 选项之间的分隔线 |
| `SelectScrollUpButton` | 向上滚动按钮，ChevronUpIcon |
| `SelectScrollDownButton` | 向下滚动按钮，ChevronDownIcon |

---

### 43. Separator — 分隔符

**文件:** `separator.tsx`  
**基础库:** radix-ui (Separator)

| 导出 | 说明 |
|---|---|
| `Separator` | 水平或垂直分隔线，`orientation: "horizontal" \| "vertical"`, `decorative`（默认 true） |

---

### 44. Sheet — 侧边面板

**文件:** `sheet.tsx`  
**基础库:** radix-ui (Dialog)

| 导出 | 说明 |
|---|---|
| `Sheet` | 根组件（基于 Dialog 实现） |
| `SheetTrigger` | 打开按钮 |
| `SheetClose` | 关闭触发器 |
| `SheetContent` | 滑出面板，`side: "top" \| "right" \| "bottom" \| "left"`, `showCloseButton`（默认 true） |
| `SheetHeader` | 头部（p-6） |
| `SheetFooter` | 底部（mt-auto, p-6） |
| `SheetTitle` | 标题，font-heading |
| `SheetDescription` | 描述文字 |

---

### 45. Sidebar — 侧边栏

**文件:** `sidebar.tsx`

| 导出 | 说明 |
|---|---|
| `SidebarProvider` | 上下文提供者，`defaultOpen`, `open`, `onOpenChange`，管理折叠状态、移动端状态、键盘快捷键（Cmd/Ctrl+B）、cookie 持久化 |
| `Sidebar` | 侧边栏面板，`side: "left" \| "right"`, `variant: "sidebar" \| "floating" \| "inset"`, `collapsible: "offcanvas" \| "icon" \| "none"`，移动端在 Sheet 中渲染 |
| `SidebarTrigger` | 侧边栏切换按钮（PanelLeftIcon） |
| `SidebarRail` | 侧边栏边缘的不可见拖拽轨道 |
| `SidebarInset` | 侧边栏旁的主内容区域，为 inset 变体调整边距 |
| `SidebarInput` | 侧边栏搜索/过滤输入框 |
| `SidebarHeader` | 侧边栏头部（p-2） |
| `SidebarFooter` | 侧边栏底部（p-2） |
| `SidebarSeparator` | 侧边栏内的分隔符 |
| `SidebarContent` | 可滚动内容区域（no-scrollbar, flex-1, overflow-auto） |
| `SidebarGroup` | 侧边栏内的逻辑分组（p-2） |
| `SidebarGroupLabel` | 分组标签（text-xs，图标模式折叠时隐藏） |
| `SidebarGroupAction` | 分组右上角的操作按钮（图标模式折叠时隐藏） |
| `SidebarGroupContent` | 分组内容区域（w-full） |
| `SidebarMenu` | 垂直菜单列表 `<ul>`（gap-0.5） |
| `SidebarMenuItem` | 单个菜单项 `<li>` |
| `SidebarMenuButton` | 主菜单按钮/链接，`isActive`, `variant: "default" \| "outline"`, `size: "default" \| "sm" \| "lg"`, `tooltip`，图标模式折叠时显示 tooltip |
| `SidebarMenuAction` | 菜单按钮右侧的操作按钮，`showOnHover` 控制仅悬停时显示 |
| `SidebarMenuBadge` | 菜单项右侧的徽章（图标模式折叠时隐藏） |
| `SidebarMenuSkeleton` | 菜单项加载骨架屏，`showIcon`，宽度随机 50-90% |
| `SidebarMenuSub` | 子菜单列表 `<ul>`（缩进 + border-l，图标模式隐藏） |
| `SidebarMenuSubItem` | 子菜单项 `<li>` |
| `SidebarMenuSubButton` | 子菜单链接/按钮，`size: "sm" \| "md"`, `isActive` |
| `useSidebar` | hook，返回 `{ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }` |

---

### 46. Skeleton — 骨架屏

**文件:** `skeleton.tsx`

| 导出 | 说明 |
|---|---|
| `Skeleton` | 脉冲占位块（animate-pulse，圆角 2xl，bg-muted） |

---

### 47. Slider — 滑块

**文件:** `slider.tsx`  
**基础库:** radix-ui (Slider)

| 导出 | 说明 |
|---|---|
| `Slider` | 范围滑块，`value`, `defaultValue`, `min`（默认 0）, `max`（默认 100），支持多个滑块，滑块白色、带阴影 |

---

### 48. Sonner (Toast) — 通知

**文件:** `sonner.tsx`  
**基础库:** sonner

| 导出 | 说明 |
|---|---|
| `Toaster` | Toast 通知提供者，读取 next-themes 主题，配置 success/info/warning/error/loading 图标 |

---

### 49. Spinner — 加载旋转器

**文件:** `spinner.tsx`

| 导出 | 说明 |
|---|---|
| `Spinner` | 旋转加载图标（animate-spin, size-4），role="status"，aria-label="Loading" |

---

### 50. Switch — 开关

**文件:** `switch.tsx`  
**基础库:** radix-ui (Switch)

| 导出 | 说明 |
|---|---|
| `Switch` | 切换开关，`size: "sm" \| "default"`，默认 h-5 w-8，小号 h-4 w-6，选中时主色背景，滑块 translateX 过渡动画 |

---

### 51. Table — 表格

**文件:** `table.tsx`

| 导出 | 说明 |
|---|---|
| `Table` | 根表格，包裹在 overflow-x-auto 的 `<div>` 中 |
| `TableHeader` | 表头 `<thead>`（行带 border-b） |
| `TableBody` | 表体 `<tbody>`（最后一行无 border-b） |
| `TableFooter` | 表尾 `<tfoot>`（bg-muted/50, border-t, 中等字重） |
| `TableRow` | 行 `<tr>`，border-b 和 hover 高亮 |
| `TableHead` | 表头单元格 `<th>`（h-10, 左对齐, 中等字重, whitespace-nowrap） |
| `TableCell` | 数据单元格 `<td>`（p-2, align-middle, whitespace-nowrap） |
| `TableCaption` | 表格标题 `<caption>`（表格下方，muted） |

---

### 52. Tabs — 标签页

**文件:** `tabs.tsx`  
**基础库:** radix-ui (Tabs)

| 导出 | 说明 |
|---|---|
| `Tabs` | 根组件，`orientation: "horizontal" \| "vertical"`（垂直模式切换为并排布局） |
| `TabsList` | 标签触发器列表，`variant: "default" \| "line"`（default: bg-muted 胶囊容器；line: 透明 + 下划线指示器） |
| `TabsTrigger` | 标签触发按钮 |
| `TabsContent` | 标签内容面板（flex-1） |
| `tabsListVariants` | CVA 变体配置 |

---

### 53. Textarea — 文本域

**文件:** `textarea.tsx`

| 导出 | 说明 |
|---|---|
| `Textarea` | 样式化 `<textarea>`，min-h-16，圆角 2xl，bg-input/50，使用 field-sizing-content，支持 resize、focus 环、无效状态 |

---

### 54. Toggle — 切换按钮

**文件:** `toggle.tsx`  
**基础库:** radix-ui (Toggle)

| 导出 | 说明 |
|---|---|
| `Toggle` | 切换按钮，`variant: "default" \| "outline"`, `size: "default" \| "sm" \| "lg"`，按下时 bg-muted |
| `toggleVariants` | CVA 变体配置 |

---

### 55. ToggleGroup — 切换按钮组

**文件:** `toggle-group.tsx`  
**基础库:** radix-ui (ToggleGroup)

| 导出 | 说明 |
|---|---|
| `ToggleGroup` | 切换按钮组，`variant`, `size`, `spacing`（默认 2）, `orientation: "horizontal" \| "vertical"`，spacing=0 时按钮连接成分段控件 |
| `ToggleGroupItem` | 组内的切换按钮，`variant`, `size`，继承上下文中的 variant/size |

---

### 56. Tooltip — 工具提示

**文件:** `tooltip.tsx`  
**基础库:** radix-ui (Tooltip)

| 导出 | 说明 |
|---|---|
| `TooltipProvider` | 上下文提供者，`delayDuration`（默认 0） |
| `Tooltip` | 根组件 |
| `TooltipTrigger` | 悬停/焦点目标 |
| `TooltipContent` | 提示气泡，`sideOffset`（默认 0），深色背景（bg-foreground），浅色文字（text-background），圆角 xl，带箭头，动画进入/退出 |

---

## 未在 barrel 中导出的组件

以下组件在源文件中定义但**未**通过 `index.tsx` 公开导出（内部使用或示例）：

| 组件/导出 | 所属文件 |
|---|---|
| `AlertDialogMedia`, `AlertDialogOverlay`, `AlertDialogPortal` | alert-dialog.tsx |
| `AvatarGroup`, `AvatarGroupCount`, `AvatarBadge` | avatar.tsx |
| `ButtonGroupSeparator`, `buttonGroupVariants` | button-group.tsx |
| `CardAction` | card.tsx |
| `useCarousel`, `CarouselApi` | carousel.tsx |
| `ComboboxClear`, `useComboboxAnchor` | combobox.tsx |
| `DatePickerDemo` | date-picker.tsx |
| `DialogPortal` | dialog.tsx |
| `PopoverHeader`, `PopoverTitle`, `PopoverDescription` | popover.tsx |
| `navigationMenuTriggerStyle` | navigation-menu.tsx |
| `alertVariants` | alert.tsx |
