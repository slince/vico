// @vscode/ripgrep 无自带类型声明，这里补充最小类型面。
declare module '@vscode/ripgrep' {
  /** 打包的 ripgrep 可执行文件的绝对路径 */
  export const rgPath: string;
}
