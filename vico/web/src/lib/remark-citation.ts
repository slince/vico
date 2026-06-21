/**
 * remark-citation — 将 [source: filename#chunkN] 模式转换为样式化引用标签的 remark 插件。
 *
 * 遍历 Markdown AST，查找包含 `[source: ...]` 的文本节点，
 * 将其拆分为普通文本 + 内联 HTML 标签的组合，便于前端渲染为引用徽章。
 */
/** 匹配 [source: filename#chunkN] 模式 */
const SOURCE_REGEX = /\[source:\s*([^\]#]+)(?:#chunk(\d+))?\]/g;

/** MDAST 节点（精简类型，仅包含本插件需要访问的字段） */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/**
 * 将包含引用标记的文本拆分为多个文本/HTML 节点。
 *
 * @param text - 原始文本
 * @returns 拆分后的节点数组
 */
function splitCitations(text: string): MdastNode[] {
  const nodes: MdastNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  SOURCE_REGEX.lastIndex = 0;
  while ((match = SOURCE_REGEX.exec(text)) !== null) {
    // 匹配之前的纯文本
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const filename = match[1].trim();
    // 插入引用徽章的 HTML 节点
    nodes.push({
      type: "html",
      value:
        `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-primary/10 text-primary text-xs font-medium">${filename}</span>`,
    });

    lastIndex = match.index + match[0].length;
  }

  // 剩余文本
  if (lastIndex < text.length) {
    nodes.push({ type: "text", value: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", value: text }];
}

/**
 * 递归遍历 MDAST 树，处理所有文本节点中的引用标记。
 *
 * @param node - 当前 MDAST 节点
 */
function walkTree(node: MdastNode): void {
  if (!node.children || !Array.isArray(node.children)) return;

  const newChildren: MdastNode[] = [];

  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      // 拆分含引用标记的文本节点
      newChildren.push(...splitCitations(child.value));
    } else {
      walkTree(child);
      newChildren.push(child);
    }
  }

  node.children = newChildren;
}

/**
 * remark 插件：将 [source: filename#chunkN] 转换为行内引用标签。
 *
 * 用法：
 * ```tsx
 * <MarkdownTextPrimitive remarkPlugins={[remarkCitation]}>
 * ```
 */
/**
 * remark 插件函数签名：接收 MDAST 树，无返回值。
 */
type RemarkPlugin = () => (tree: any) => void;

const remarkCitation: RemarkPlugin = () => {
  return (tree: any) => {
    walkTree(tree as MdastNode);
  };
};

export default remarkCitation;
