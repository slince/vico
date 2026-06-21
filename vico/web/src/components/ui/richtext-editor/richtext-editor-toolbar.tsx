import * as React from 'react';
import { Editor, Element, Transforms } from 'slate';
import { useSlate } from 'slate-react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading,
  Quote,
  List,
  ListOrdered,
  SquareCode,
  Table,
  Image,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toggle } from '@/components/ui/toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { insertTable } from './with-tables';
import { insertImage } from './with-images';
import type { CustomElement, CustomText } from './types';

/** 判断 block 节点是否活跃 */
const isBlockActive = (editor: Editor, format: CustomElement['type']) => {
  const [match] = Array.from(
    Editor.nodes(editor, {
      match: (n) => Element.isElement(n) && (n as CustomElement).type === format,
    }),
  );
  return !!match;
};

/** 判断 mark 是否活跃 */
const isMarkActive = (editor: Editor, format: string) => {
  const marks = Editor.marks(editor);
  return marks ? (marks as Record<string, unknown>)[format] === true : false;
};

/** 切换 mark */
const toggleMark = (editor: Editor, format: string) => {
  const isActive = isMarkActive(editor, format as keyof Omit<CustomElement, 'type'>);
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

/** 切换 block 类型 */
const toggleBlock = (editor: Editor, format: CustomElement['type']) => {
  const isActive = isBlockActive(editor, format);
  const isList = format === 'bulleted-list' || format === 'numbered-list';

  Transforms.unwrapNodes(editor, {
    match: (n) =>
      Element.isElement(n) &&
      ((n as CustomElement).type === 'bulleted-list' ||
        (n as CustomElement).type === 'numbered-list'),
    split: true,
  });

  if (isActive) {
    // 已激活 → 切换回 paragraph
    Transforms.setNodes(editor, { type: 'paragraph' } as Partial<CustomElement>);
  } else if (isList) {
    // 列表需要包裹结构
    const block: CustomElement = { type: 'list-item', children: [] };
    Transforms.setNodes(editor, block);
    const wrapper: CustomElement = { type: format, children: [block] } as unknown as CustomElement;
    Transforms.wrapNodes(editor, wrapper);
  } else {
    Transforms.setNodes(editor, { type: format } as Partial<CustomElement>);
  }
};

/** 处理图片插入弹窗 */
const handleInsertImage = (editor: Editor) => {
  const url = window.prompt('Enter image URL:');
  if (url) {
    insertImage(editor, url);
  }
};

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  onToggle: () => void;
}

/** 单个工具栏按钮 */
function ToolbarButton({ icon: Icon, label, isActive, onToggle }: ToolbarButtonProps) {
  return (
    <Toggle
      size="sm"
      pressed={isActive}
      onPressedChange={onToggle}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </Toggle>
  );
}

/**
 * 富文本编辑器工具栏 — 提供文本格式化和块级元素插入按钮。
 */
export function RichtextEditorToolbar({
  className,
}: {
  className?: string;
}) {
  const editor = useSlate();

  return (
    <div
      data-slot="richtext-editor-toolbar"
      className={cn(
        'flex flex-wrap items-center gap-0.5 p-1 border-b border-border bg-muted/30',
        className,
      )}
    >
      {/* 内联标记 */}
      <ToolbarButton
        icon={Bold}
        label="Bold"
        isActive={isMarkActive(editor, 'bold')}
        onToggle={() => toggleMark(editor, 'bold')}
      />
      <ToolbarButton
        icon={Italic}
        label="Italic"
        isActive={isMarkActive(editor, 'italic')}
        onToggle={() => toggleMark(editor, 'italic')}
      />
      <ToolbarButton
        icon={Strikethrough}
        label="Strikethrough"
        isActive={isMarkActive(editor, 'strikethrough')}
        onToggle={() => toggleMark(editor, 'strikethrough')}
      />
      <ToolbarButton
        icon={Code}
        label="Inline Code"
        isActive={isMarkActive(editor, 'code')}
        onToggle={() => toggleMark(editor, 'code')}
      />

      <div className="w-px h-5 bg-border mx-1" />

      {/* 标题下拉 */}
      <HeadingSelect />

      <div className="w-px h-5 bg-border mx-1" />

      {/* 块级元素 */}
      <ToolbarButton
        icon={Quote}
        label="Blockquote"
        isActive={isBlockActive(editor, 'block-quote')}
        onToggle={() => toggleBlock(editor, 'block-quote')}
      />
      <ToolbarButton
        icon={SquareCode}
        label="Code Block"
        isActive={isBlockActive(editor, 'code-block')}
        onToggle={() => toggleBlock(editor, 'code-block')}
      />
      <ToolbarButton
        icon={List}
        label="Bulleted List"
        isActive={isBlockActive(editor, 'bulleted-list')}
        onToggle={() => toggleBlock(editor, 'bulleted-list')}
      />
      <ToolbarButton
        icon={ListOrdered}
        label="Numbered List"
        isActive={isBlockActive(editor, 'numbered-list')}
        onToggle={() => toggleBlock(editor, 'numbered-list')}
      />

      <div className="w-px h-5 bg-border mx-1" />

      {/* 插入 */}
      <ToolbarButton
        icon={Table}
        label="Insert Table"
        isActive={false}
        onToggle={() => insertTable(editor)}
      />
      <ToolbarButton
        icon={Image}
        label="Insert Image"
        isActive={false}
        onToggle={() => handleInsertImage(editor)}
      />
    </div>
  );
}

/** 标题级别下拉选择器 */
function HeadingSelect() {
  const editor = useSlate();
  const [match] = Array.from(
    Editor.nodes(editor, {
      match: (n) =>
        Element.isElement(n) && (n as CustomElement).type === 'heading',
    }),
  );
  const currentLevel = match && (match[0] as CustomElement).type === 'heading'
    ? (match[0] as { type: 'heading'; level: number }).level
    : 0;

  const handleValueChange = (value: string) => {
    const level = parseInt(value, 10);
    if (level === 0) {
      Transforms.setNodes(editor, { type: 'paragraph' } as Partial<CustomElement>);
    } else {
      Transforms.setNodes(editor, {
        type: 'heading',
        level,
      } as Partial<CustomElement>);
    }
  };

  return (
    <Select
      value={currentLevel > 0 ? String(currentLevel) : '0'}
      onValueChange={handleValueChange}
    >
      <SelectTrigger
        data-slot="richtext-editor-heading-select"
        className="h-7 w-auto min-w-0 gap-1 border-0 bg-transparent px-2 text-xs hover:bg-muted [&>svg]:hidden"
      >
        <Heading className="size-4" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">Paragraph</SelectItem>
        <SelectItem value="1">Heading 1</SelectItem>
        <SelectItem value="2">Heading 2</SelectItem>
        <SelectItem value="3">Heading 3</SelectItem>
        <SelectItem value="4">Heading 4</SelectItem>
        <SelectItem value="5">Heading 5</SelectItem>
        <SelectItem value="6">Heading 6</SelectItem>
      </SelectContent>
    </Select>
  );
}
