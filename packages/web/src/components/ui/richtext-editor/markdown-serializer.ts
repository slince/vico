import type { Descendant } from 'slate';
import type { CustomElement, CustomText } from './types';

/** 转义 Markdown 特殊字符 */
function escapeMd(text: string): string {
  return text.replace(/([\\*_`~\[\]#])/g, '\\$1');
}

/** 将内联文本序列化为 Markdown */
function serializeLeaf(node: CustomText): string {
  let t = node.text;
  // 按从外到内的顺序包裹标记
  if (node.strikethrough) t = `~~${t}~~`;
  if (node.bold) t = `**${t}**`;
  if (node.italic) t = `*${t}*`;
  if (node.code) t = `\`${t}\``;
  // 无标记的普通文本需要转义
  if (!node.bold && !node.italic && !node.strikethrough && !node.code) {
    return escapeMd(t);
  }
  return t;
}

/** 将节点文本内容序列化为一行 Markdown（不含块级包装） */
function serializeChildren(nodes: CustomText[]): string {
  return nodes.map(serializeLeaf).join('');
}

/** 递归序列化 Slate 节点树为 Markdown 字符串 */
export function serialize(nodes: Descendant[]): string {
  let result = '';

  for (const node of nodes) {
    const el = node as CustomElement;

    switch (el.type) {
      case 'paragraph':
        result += serializeChildren(el.children) + '\n\n';
        break;

      case 'heading':
        result += '#'.repeat(el.level) + ' ' + serializeChildren(el.children) + '\n\n';
        break;

      case 'block-quote':
        result += '> ' + serializeChildren(el.children) + '\n\n';
        break;

      case 'code-block':
        result += '```\n' + serializeChildren(el.children) + '\n```\n\n';
        break;

      case 'bulleted-list':
        for (const item of el.children) {
          const li = item as CustomElement;
          if (li.type === 'list-item') {
            result += '- ' + serializeChildren(li.children) + '\n';
          }
        }
        result += '\n';
        break;

      case 'numbered-list':
        for (let i = 0; i < el.children.length; i++) {
          const li = el.children[i] as CustomElement;
          if (li.type === 'list-item') {
            result += `${i + 1}. ` + serializeChildren(li.children) + '\n';
          }
        }
        result += '\n';
        break;

      case 'table':
        // 序列化表格行
        if (el.children.length > 0) {
          const rows = el.children as CustomElement[];
          const colCount =
            rows[0]?.children?.length || 1;

          for (let ri = 0; ri < rows.length; ri++) {
            const cells = (rows[ri] as CustomElement).children as CustomElement[];
            result += '| ' + cells.map((c) => serializeChildren((c as unknown as CustomElement).children as CustomText[])).join(' | ') + ' |\n';
            // 表头分隔行
            if (ri === 0) {
              result += '| ' + Array(colCount).fill('---').join(' | ') + ' |\n';
            }
          }
          result += '\n';
        }
        break;

      case 'image':
        result += `![${el.alt || ''}](${el.url})\n\n`;
        break;

      default:
        // 不认识的类型，尝试按段落处理
        if ('children' in el) {
          const children = (el as CustomElement).children as CustomText[];
          if (children && children.length > 0) {
            result += serializeChildren(children) + '\n\n';
          }
        }
    }
  }

  return result.trimEnd() + '\n';
}
