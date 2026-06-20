import * as React from 'react';
import { createEditor, type Descendant } from 'slate';
import { Slate, Editable, withReact, type RenderElementProps } from 'slate-react';
import { withHistory } from 'slate-history';
import { cn } from '@/lib/utils';
import { serialize } from './markdown-serializer';
import { deserialize } from './markdown-deserializer';
import { withTables } from './with-tables';
import { withImages } from './with-images';
import { RichtextEditorToolbar } from './richtext-editor-toolbar';
import { TableElementRenderer, TableRowRenderer, TableCellRenderer } from './table-element';
import { ImageElementRenderer } from './image-element';
import { renderElement as renderBlockElement } from './richtext-element';
import type { RichtextEditorProps, CustomElement } from './types';

/** 默认空文档 */
const EMPTY_DOC: Descendant[] = [
  { type: 'paragraph', children: [{ text: '' }] },
] as unknown as Descendant[];

/** 渲染叶子节点（内联文本标记） */
function renderLeaf({ attributes, children, leaf }: any) {
  let el = <>{children}</>;
  if (leaf.bold) {
    el = <strong>{el}</strong>;
  }
  if (leaf.italic) {
    el = <em>{el}</em>;
  }
  if (leaf.strikethrough) {
    el = <del>{el}</del>;
  }
  if (leaf.code) {
    el = (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-sm">{el}</code>
    );
  }
  return <span {...attributes}>{el}</span>;
}

/** 组合 element renderer：block 元素 + table + image */
function renderElement(props: RenderElementProps) {
  const type = (props.element as CustomElement).type;

  switch (type) {
    case 'table':
      return TableElementRenderer(props);
    case 'table-row':
      return TableRowRenderer(props);
    case 'table-cell':
      return TableCellRenderer(props);
    case 'image':
      return ImageElementRenderer(props);
    default:
      return renderBlockElement(props);
  }
}

/**
 * 富文本编辑器组件 — 基于 Slate 的所见即所得编辑器。
 *
 * 支持标题、加粗、斜体、删除线、行内代码、引用、代码块、
 * 无序/有序列表、表格、图片等格式，输入输出均为 Markdown 字符串。
 */
export function RichtextEditor({
  value,
  onChange,
  placeholder = 'Start typing...',
  className,
  disabled = false,
  readOnly = false,
  minHeight = 'min-h-[200px]',
  showToolbar = true,
}: RichtextEditorProps) {
  // 编辑器实例（含所有插件）
  const editor = React.useMemo(
    () => withImages(withTables(withHistory(withReact(createEditor())))),
    [],
  );

  // 初始值
  const [slateValue, setSlateValue] = React.useState<Descendant[]>(() => {
    try {
      return deserialize(value);
    } catch {
      return [...EMPTY_DOC];
    }
  });

  // 错误态
  const [deserializeError, setDeserializeError] = React.useState(false);

  // 外部 value 变更时同步
  const prevValueRef = React.useRef(value);
  React.useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value;
      try {
        setSlateValue(deserialize(value));
        setDeserializeError(false);
      } catch {
        setDeserializeError(true);
      }
    }
  }, [value]);

  // onChange → 序列化后回调
  const handleChange = React.useCallback(
    (newValue: Descendant[]) => {
      setSlateValue(newValue);
      try {
        const md = serialize(newValue);
        onChange(md);
      } catch {
        // 序列化失败不更新外部
      }
    },
    [onChange],
  );

  return (
    <div
      data-slot="richtext-editor"
      className={cn(
        'rounded-2xl border border-input bg-input/50 overflow-hidden',
        'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30',
        'transition-[color,box-shadow] duration-200',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      <Slate editor={editor} initialValue={slateValue} onValueChange={handleChange}>
        {showToolbar && <RichtextEditorToolbar />}
        <div className={cn('px-3 py-2', minHeight)}>
          {deserializeError && (
            <div className="mb-2 text-xs text-destructive">
              Failed to parse content. The editor has been reset.
            </div>
          )}
          <Editable
            className="outline-none h-full"
            placeholder={placeholder}
            readOnly={readOnly}
            disabled={disabled}
            renderElement={renderElement}
            renderLeaf={renderLeaf}
          />
        </div>
      </Slate>
    </div>
  );
}
