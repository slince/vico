// @vico/browser-tool - Playwright 懒加载与浏览器启动的共享逻辑
//
// Playwright 为可选依赖，未安装时工具返回明确的安装提示。

/** 未安装 Playwright 时的安装提示 */
export const PLAYWRIGHT_INSTALL_HINT =
  'Playwright is not installed. Run: npm install playwright && npx playwright install chromium';

let playwrightAvailable = false;
let playwrightError = '';

/** 懒加载 Playwright（避免编译时模块解析错误） */
async function loadPlaywright(): Promise<any> {
  // 使用 new Function 包装动态 import，避免 TypeScript 编译时解析
  return new Function('return import("playwright")')();
}

/**
 * 检查 Playwright 是否可用，首次失败后缓存错误信息。
 *
 * @returns true 表示可用
 */
export async function checkPlaywright(): Promise<boolean> {
  if (playwrightAvailable) return true;
  try {
    await loadPlaywright();
    playwrightAvailable = true;
    return true;
  } catch (err: any) {
    playwrightError = err.message;
    return false;
  }
}

/** 启动 headless Chromium 浏览器 */
export async function launchBrowser() {
  const pw = await loadPlaywright();
  return pw.chromium.launch({ headless: true });
}

/** 未安装 Playwright 时的详细错误（含底层错误信息） */
export function playwrightInstallError(): string {
  return `${PLAYWRIGHT_INSTALL_HINT}\nDetails: ${playwrightError}`;
}
