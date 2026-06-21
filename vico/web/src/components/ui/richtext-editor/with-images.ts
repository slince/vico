import { Editor, Element, Transforms, type NodeEntry } from 'slate';
import type { CustomElement, ImageElement } from './types';

/**
 * 图片编辑器插件 — 将图片元素标记为 void 行内元素。
 */
export function withImages<T extends Editor>(editor: T): T {
  const { isVoid, isInline } = editor;

  editor.isVoid = (element) => {
    return (element as CustomElement).type === 'image' || isVoid(element);
  };

  editor.isInline = (element) => {
    return (element as CustomElement).type === 'image' ? true : isInline(element);
  };

  return editor;
}

/** 在当前选区插入图片 */
export function insertImage(editor: Editor, url: string, alt?: string): void {
  const image: ImageElement = {
    type: 'image',
    url,
    alt: alt || '',
    children: [{ text: '' }],
  };
  Transforms.insertNodes(editor, image);
  // 图片后插入空段落以便继续编辑
  Transforms.insertNodes(editor, {
    type: 'paragraph',
    children: [{ text: '' }],
  } as CustomElement);
}
