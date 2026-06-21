import * as React from 'react';
import { type RenderElementProps } from 'slate-react';
import { cn } from '@/lib/utils';
import type { CustomElement } from './types';

/** 段落元素 */
function ParagraphElement({ attributes, children }: RenderElementProps) {
  return (
    <p {...attributes} data-slot="richtext-editor-paragraph" className="mb-1 last:mb-0">
      {children}
    </p>
  );
}

/** 标题元素 */
function HeadingElement({ attributes, children, element }: RenderElementProps) {
  const el = element as CustomElement;
  const level = el.type === 'heading' ? el.level : 1;
  const sizeClasses: Record<number, string> = {
    1: 'text-2xl font-bold',
    2: 'text-xl font-bold',
    3: 'text-lg font-semibold',
    4: 'text-base font-semibold',
    5: 'text-sm font-semibold',
    6: 'text-xs font-semibold',
  };
  const className = cn(sizeClasses[level] || sizeClasses[1], 'mb-1 last:mb-0');

  switch (level) {
    case 1: return <h1 {...attributes} data-slot="richtext-editor-heading" className={className}>{children}</h1>;
    case 2: return <h2 {...attributes} data-slot="richtext-editor-heading" className={className}>{children}</h2>;
    case 3: return <h3 {...attributes} data-slot="richtext-editor-heading" className={className}>{children}</h3>;
    case 4: return <h4 {...attributes} data-slot="richtext-editor-heading" className={className}>{children}</h4>;
    case 5: return <h5 {...attributes} data-slot="richtext-editor-heading" className={className}>{children}</h5>;
    default: return <h6 {...attributes} data-slot="richtext-editor-heading" className={className}>{children}</h6>;
  }
}

/** 引用元素 */
function BlockQuoteElement({ attributes, children }: RenderElementProps) {
  return (
    <blockquote
      {...attributes}
      data-slot="richtext-editor-blockquote"
      className="border-l-2 border-border pl-3 italic text-muted-foreground mb-1 last:mb-0"
    >
      {children}
    </blockquote>
  );
}

/** 代码块元素 */
function CodeBlockElement({ attributes, children }: RenderElementProps) {
  return (
    <pre
      {...attributes}
      data-slot="richtext-editor-codeblock"
      className="bg-muted rounded-md p-3 font-mono text-sm overflow-x-auto mb-1 last:mb-0"
    >
      <code>{children}</code>
    </pre>
  );
}

/** 列表项 */
function ListItemElement({ attributes, children }: RenderElementProps) {
  return (
    <li
      {...attributes}
      data-slot="richtext-editor-list-item"
      className="mb-0.5 last:mb-0"
    >
      {children}
    </li>
  );
}

/** 无序列表 */
function BulletedListElement({ attributes, children }: RenderElementProps) {
  return (
    <ul
      {...attributes}
      data-slot="richtext-editor-bulleted-list"
      className="list-disc list-inside mb-1 last:mb-0"
    >
      {children}
    </ul>
  );
}

/** 有序列表 */
function NumberedListElement({ attributes, children }: RenderElementProps) {
  return (
    <ol
      {...attributes}
      data-slot="richtext-editor-numbered-list"
      className="list-decimal list-inside mb-1 last:mb-0"
    >
      {children}
    </ol>
  );
}

/** 默认段落回退 */
function DefaultElement({ attributes, children }: RenderElementProps) {
  return (
    <p {...attributes} data-slot="richtext-editor-default" className="mb-1 last:mb-0">
      {children}
    </p>
  );
}

/** 根据元素类型返回对应渲染器 */
export function renderElement(props: RenderElementProps) {
  const { element } = props;
  const el = element as CustomElement;

  switch (el.type) {
    case 'paragraph':
      return ParagraphElement(props);
    case 'heading':
      return HeadingElement(props);
    case 'block-quote':
      return BlockQuoteElement(props);
    case 'code-block':
      return CodeBlockElement(props);
    case 'bulleted-list':
      return BulletedListElement(props);
    case 'numbered-list':
      return NumberedListElement(props);
    case 'list-item':
      return ListItemElement(props);
    // table 和 image 由各自文件处理
    default:
      return DefaultElement(props);
  }
}
