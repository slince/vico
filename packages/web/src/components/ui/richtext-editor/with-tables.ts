import { Editor, Element, Transforms, Range, Point, type NodeEntry } from 'slate';
import type { CustomElement, TableElement, TableRowElement, TableCellElement } from './types';

/**
 * 表格编辑器插件 — 处理插入、规范化和光标边界。
 */
export function withTables<T extends Editor>(editor: T): T {
  const { deleteBackward, deleteForward, insertBreak, normalizeNode } = editor;

  editor.deleteBackward = (unit) => {
    const { selection } = editor;
    if (selection && Range.isCollapsed(selection)) {
      const [cell] = Editor.nodes(editor, {
        match: (n) => Element.isElement(n) && (n as TableCellElement).type === 'table-cell',
      });
      if (cell) {
        // 防止从单元格删除到表格结构
        const [, cellPath] = cell;
        const cellStart = Editor.start(editor, cellPath);
        if (Point.equals(selection.anchor, cellStart)) {
          return;
        }
      }
    }
    deleteBackward(unit);
  };

  editor.deleteForward = (unit) => {
    const { selection } = editor;
    if (selection && Range.isCollapsed(selection)) {
      const [cell] = Editor.nodes(editor, {
        match: (n) => Element.isElement(n) && (n as TableCellElement).type === 'table-cell',
      });
      if (cell) {
        const [, cellPath] = cell;
        const cellEnd = Editor.end(editor, cellPath);
        if (Point.equals(selection.anchor, cellEnd)) {
          return;
        }
      }
    }
    deleteForward(unit);
  };

  editor.insertBreak = () => {
    const { selection } = editor;
    if (selection) {
      const [cell] = Editor.nodes(editor, {
        match: (n) => Element.isElement(n) && (n as TableCellElement).type === 'table-cell',
      });
      if (cell) {
        // 在单元格内按回车插入软换行，而非新块
        Transforms.insertText(editor, '\n');
        return;
      }
    }
    insertBreak();
  };

  editor.normalizeNode = ([node, path]: NodeEntry) => {
    const el = node as TableElement | TableRowElement | TableCellElement;

    if (Element.isElement(node) && el.type === 'table') {
      // 表格只能包含 table-row
      for (const [child, childPath] of Editor.nodes(editor, { at: path, match: (n) => n !== node })) {
        if (Element.isElement(child) && childPath.length === path.length + 1 && (child as CustomElement).type !== 'table-row') {
          Transforms.removeNodes(editor, { at: childPath });
          return;
        }
      }
    }

    if (Element.isElement(node) && el.type === 'table-row') {
      for (const [child, childPath] of Editor.nodes(editor, { at: path, match: (n) => n !== node })) {
        if (Element.isElement(child) && childPath.length === path.length + 1 && (child as CustomElement).type !== 'table-cell') {
          Transforms.removeNodes(editor, { at: childPath });
          return;
        }
      }
    }

    if (Element.isElement(node) && el.type === 'table-cell') {
      if (el.children.length === 0) {
        Transforms.insertNodes(editor, { text: '' }, { at: [...path, 0] });
        return;
      }
    }

    normalizeNode([node, path]);
  };

  return editor;
}

/** 创建 3x3 表格骨架 */
function createTable(rows = 3, cols = 3): TableElement {
  const tableRows: TableRowElement[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: TableCellElement[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push({
        type: 'table-cell',
        children: [{ text: c === 0 && r === 0 ? '' : '' }],
      });
    }
    tableRows.push({ type: 'table-row', children: cells });
  }
  return { type: 'table', children: tableRows };
}

/** 在当前选区插入表格 */
export function insertTable(editor: Editor): void {
  const table = createTable(3, 3);
  Transforms.insertNodes(editor, table);
  // 确保表格前后有空段落
  Transforms.insertNodes(editor, {
    type: 'paragraph',
    children: [{ text: '' }],
  } as CustomElement);
}
