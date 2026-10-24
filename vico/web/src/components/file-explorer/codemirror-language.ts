import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { c, cpp, csharp, java, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { php } from '@codemirror/legacy-modes/mode/php';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { xml } from '@codemirror/legacy-modes/mode/xml';

/**
 * 根据文件扩展名猜测语言标识。
 *
 * 供两处复用：浏览态的高亮渲染（markdown 判断）与编辑态 CodeMirror 语言选择。
 */
export function guessLanguage(relPath: string): string {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', markdown: 'markdown', mdx: 'mdx', html: 'html', css: 'css', scss: 'scss',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    php: 'php', swift: 'swift', sql: 'sql', sh: 'bash', bash: 'bash',
    zsh: 'bash', xml: 'xml', svg: 'xml', vue: 'vue', svelte: 'svelte',
  };
  return map[ext] ?? 'text';
}

/**
 * 根据文件路径返回 CodeMirror 语言扩展。
 *
 * 常用语言使用官方语言包（提供更精确的解析与括号匹配），
 * 其余语言回退到 legacy-modes 的 StreamLanguage 做基础高亮；
 * 未知语言返回空数组（plain text，编辑能力仍可用）。
 */
export function getCodeMirrorExtensions(filePath: string): Extension[] {
  switch (guessLanguage(filePath)) {
    case 'typescript':
      return [javascript({ typescript: true })];
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })];
    case 'javascript':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'json':
      return [json()];
    case 'yaml':
      return [yaml()];
    case 'toml':
      return [StreamLanguage.define(toml)];
    case 'markdown':
    case 'mdx':
      return [markdown()];
    case 'html':
    case 'vue':
    case 'svelte':
      return [html()];
    case 'css':
    case 'scss':
      return [css()];
    case 'python':
      return [python()];
    case 'sql':
      return [sql()];
    case 'ruby':
      return [StreamLanguage.define(ruby)];
    case 'go':
      return [StreamLanguage.define(go)];
    case 'rust':
      return [StreamLanguage.define(rust)];
    case 'java':
      return [StreamLanguage.define(java)];
    case 'kotlin':
      return [StreamLanguage.define(kotlin)];
    case 'c':
      return [StreamLanguage.define(c)];
    case 'cpp':
      return [StreamLanguage.define(cpp)];
    case 'csharp':
      return [StreamLanguage.define(csharp)];
    case 'php':
      return [StreamLanguage.define(php)];
    case 'swift':
      return [StreamLanguage.define(swift)];
    case 'bash':
      return [StreamLanguage.define(shell)];
    case 'xml':
      return [StreamLanguage.define(xml)];
    default:
      return [];
  }
}
