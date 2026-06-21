import type { Descendant } from 'slate';
import type { CustomElement, CustomText } from './types';

/** 解析行内 Markdown 标记为 Slate 文本节点 */
function parseInline(text: string): CustomText[] {
  if (!text) return [{ text: '' }];

  const leaves: CustomText[] = [];
  // 正则匹配行内标记：粗体、斜体、删除线、行内代码
  const pattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(~~(.+?)~~)|(`(.+?)`)|([^*~`]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[2] !== undefined) {
      // **bold**
      leaves.push({ text: match[2], bold: true });
    } else if (match[4] !== undefined) {
      // *italic*
      leaves.push({ text: match[4], italic: true });
    } else if (match[6] !== undefined) {
      // ~~strikethrough~~
      leaves.push({ text: match[6], strikethrough: true });
    } else if (match[8] !== undefined) {
      // `code`
      leaves.push({ text: match[8], code: true });
    } else if (match[9] !== undefined) {
      // 普通文本
      leaves.push({ text: match[9] });
    }
  }

  return leaves.length > 0 ? leaves : [{ text }];
}

/** 去除行尾换行符 */
function trimTrailingNewlines(arr: string[]): string[] {
  while (arr.length > 0 && arr[arr.length - 1] === '') arr.pop();
  return arr;
}

/**
 * 将 Markdown 字符串反序列化为 Slate 节点树。
 * 使用行级状态机处理块级元素。
 */
export function deserialize(markdown: string): Descendant[] {
  if (!markdown || !markdown.trim()) {
    return [{ type: 'paragraph', children: [{ text: '' }] } as CustomElement];
  }

  const lines = markdown.split('\n');
  const nodes: CustomElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行 → 跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 代码块 ```...```
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push({
        type: 'code-block',
        children: [{ text: codeLines.join('\n') }],
      });
      continue;
    }

    // 图片 ![alt](url)
    const imageMatch = line.trim().match(/^!\[(.*)\]\((.+)\)$/);
    if (imageMatch) {
      nodes.push({
        type: 'image',
        url: imageMatch[2],
        alt: imageMatch[1] || '',
        children: [{ text: '' }],
      });
      i++;
      continue;
    }

    // 表格 | ... | ... |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows: CustomElement[] = [];
      // 解析表头行
      tableRows.push(parseTableRow(line));
      i++;
      // 跳过分隔行 |---|---|
      if (i < lines.length && lines[i].trim().startsWith('|') && lines[i].includes('---')) {
        i++;
      }
      // 解析数据行
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableRows.push(parseTableRow(lines[i]));
        i++;
      }
      nodes.push({ type: 'table', children: tableRows } as unknown as CustomElement);
      continue;
    }

    // 标题 # ... ###### ...
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // 引用 > ...
    if (line.startsWith('> ')) {
      nodes.push({
        type: 'block-quote',
        children: parseInline(line.slice(2)),
      });
      i++;
      continue;
    }

    // 无序列表 - ...
    if (line.startsWith('- ')) {
      const listItems: CustomElement[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        listItems.push({
          type: 'list-item',
          children: parseInline(lines[i].slice(2)),
        });
        i++;
      }
      nodes.push({ type: 'bulleted-list', children: listItems } as unknown as CustomElement);
      continue;
    }

    // 有序列表 1. ...
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      const listItems: CustomElement[] = [];
      while (i < lines.length) {
        const olm = lines[i].match(/^\d+\.\s+(.+)$/);
        if (!olm) break;
        listItems.push({
          type: 'list-item',
          children: parseInline(olm[1]),
        });
        i++;
      }
      nodes.push({ type: 'numbered-list', children: listItems } as unknown as CustomElement);
      continue;
    }

    // 普通段落
    nodes.push({
      type: 'paragraph',
      children: parseInline(line),
    });
    i++;
  }

  if (nodes.length === 0) {
    return [{ type: 'paragraph', children: [{ text: '' }] } as CustomElement];
  }

  return nodes as Descendant[];
}

/** 将表格行字符串解析为 table-row 元素 */
function parseTableRow(line: string): CustomElement {
  const cells = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  return {
    type: 'table-row',
    children: cells.map((text) => ({
      type: 'table-cell',
      children: parseInline(text),
    })),
  } as unknown as CustomElement;
}
