"use client";

import { Collapsible } from "@base-ui/react";
import { forwardRef } from "react";

/**
 * assistant-ui 元素专用的 Collapsible 封装。
 *
 * 底层使用 Base UI（`@base-ui/react`）而非 radix-ui，因为它输出元素侧 CSS
 * 依赖的 `data-open` / `data-panel-open` / `--collapsible-panel-height` 等
 * 约定，保证 chevron 旋转与面板高度动画正常。
 */
export const CollapsibleRoot = forwardRef<
  React.ComponentRef<typeof Collapsible.Root>,
  React.ComponentPropsWithoutRef<typeof Collapsible.Root>
>(function CollapsibleRoot(props, ref) {
  return <Collapsible.Root ref={ref} data-slot="collapsible" {...props} />;
});

/**
 * 触发展开/收起的面板触发器。
 */
export function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof Collapsible.Trigger>) {
  return (
    <Collapsible.Trigger data-slot="collapsible-trigger" {...props} />
  );
}

/**
 * 展开/收起的内容面板（Base UI 中名为 Panel，这里沿用 Content 命名）。
 */
export function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof Collapsible.Panel>) {
  return (
    <Collapsible.Panel data-slot="collapsible-content" {...props} />
  );
}
