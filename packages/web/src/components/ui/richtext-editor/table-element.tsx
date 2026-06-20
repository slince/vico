import * as React from 'react';
import { type RenderElementProps } from 'slate-react';
import { cn } from '@/lib/utils';

/**
 * 表格容器渲染器 — 使用原生 <table> 渲染，附加 Tailwind 样式。
 */
export function TableElementRenderer({
  attributes,
  children,
}: RenderElementProps) {
  return (
    <table
      {...attributes}
      data-slot="richtext-editor-table"
      className="border-collapse border border-border w-full my-2"
    >
      <tbody>{children}</tbody>
    </table>
  );
}

/**
 * 表格行渲染器。
 */
export function TableRowRenderer({
  attributes,
  children,
}: RenderElementProps) {
  return (
    <tr {...attributes} data-slot="richtext-editor-table-row">
      {children}
    </tr>
  );
}

/**
 * 表格单元格渲染器 — 使用 contentEditable 为 false 让 Slate 管理内容。
 */
export function TableCellRenderer({
  attributes,
  children,
}: RenderElementProps) {
  return (
    <td
      {...attributes}
      data-slot="richtext-editor-table-cell"
      className={cn(
        'border border-border p-2 min-w-[80px]',
        'text-sm align-top',
      )}
    >
      {children}
    </td>
  );
}
