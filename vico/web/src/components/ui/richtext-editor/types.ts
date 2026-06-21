import type { BaseEditor, Descendant } from 'slate';
import type { ReactEditor } from 'slate-react';
import type { HistoryEditor } from 'slate-history';

/** 块级元素类型 */
export type BlockElement =
  | { type: 'paragraph'; children: CustomText[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: CustomText[] }
  | { type: 'block-quote'; children: CustomText[] }
  | { type: 'code-block'; children: CustomText[] };

/** 列表容器元素 */
export type ListElement =
  | { type: 'bulleted-list'; children: CustomElement[] }
  | { type: 'numbered-list'; children: CustomElement[] };

/** 列表项元素 */
export type ListItemElement = {
  type: 'list-item';
  children: CustomText[];
};

/** 表格相关元素 */
export type TableElement = {
  type: 'table';
  children: TableRowElement[];
};
export type TableRowElement = {
  type: 'table-row';
  children: TableCellElement[];
};
export type TableCellElement = {
  type: 'table-cell';
  children: CustomText[];
};

/** 图片元素 */
export type ImageElement = {
  type: 'image';
  url: string;
  alt?: string;
  children: [{ text: '' }];
};

/** 所有自定义元素联合类型 */
export type CustomElement =
  | BlockElement
  | ListElement
  | ListItemElement
  | TableElement
  | TableRowElement
  | TableCellElement
  | ImageElement;

/** 自定义文本标记 */
export type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
};

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

/** RichtextEditor 组件 props */
export interface RichtextEditorProps {
  /** Markdown 字符串值（受控） */
  value: string;
  /** 值变更回调，返回 Markdown 字符串 */
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  minHeight?: string;
  showToolbar?: boolean;
}
