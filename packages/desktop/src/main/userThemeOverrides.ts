import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/**
 * 用户级主题覆盖：读取 userData/ui/theme-overrides.css 并注入主窗口。
 *
 * 主题体系（Zai Light/Dark）由 CSS 变量驱动，但插件生态不暴露界面渲染层
 * 扩展点；这个受控逃生口让用户不改源码即可微调外观。规格见
 * specs/desktop/user-theme-overrides.md。
 *
 * 设计约束：
 * - 仅主进程实现，不新增 IPC 通道，renderer 不感知；
 * - 文件不存在/读取失败时零行为变化；
 * - insertCSS 只对当前页面加载生效，因此每次 did-finish-load 重新读取注入，
 *   用户改文件后刷新窗口即可生效，无需重启。
 */

const THEME_OVERRIDES_RELATIVE_PATH = join("ui", "theme-overrides.css");
/** 覆盖文件上限；正常微调远用不到，超限更可能是路径指错文件。 */
const THEME_OVERRIDES_MAX_BYTES = 256 * 1024;

/** 读取结果：css 为注入内容；oversize 表示文件超限应告警；null 表示无需注入。 */
type ThemeOverridesResult = { css: string } | { oversize: true } | null;

export function readUserThemeOverridesCss(userDataPath: string): ThemeOverridesResult {
  const filePath = join(userDataPath, THEME_OVERRIDES_RELATIVE_PATH);
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return null;
  }
  if (size > THEME_OVERRIDES_MAX_BYTES) {
    return { oversize: true };
  }
  try {
    const css = readFileSync(filePath, "utf8").trim();
    return css.length > 0 ? { css } : null;
  } catch {
    return null;
  }
}

export function attachUserThemeOverrides(
  win: BrowserWindow,
  deps: {
    getUserDataPath: () => string;
    logger: { warn: (...args: unknown[]) => void };
  },
): void {
  let warnedOversize = false;
  win.webContents.on("did-finish-load", () => {
    const result = readUserThemeOverridesCss(deps.getUserDataPath());
    if (!result) return;
    if ("oversize" in result) {
      // 超限大概率是用户把路径指到了别的文件：每个窗口只提醒一次，避免刷新即刷屏。
      if (!warnedOversize) {
        warnedOversize = true;
        deps.logger.warn("[user-theme-overrides] file exceeds limit, skipped", {
          filePath: join(deps.getUserDataPath(), THEME_OVERRIDES_RELATIVE_PATH),
          maxBytes: THEME_OVERRIDES_MAX_BYTES,
          webContentsId: win.webContents.id,
        });
      }
      return;
    }
    // 不用 insertCSS：它的 author 样式在 Chromium 中排于文档样式之前，同等特异性
    // 会被内置主题变量压制，用户只能靠 !important 兜底。改为向 head 末尾追加
    // <style> 节点，层叠顺序天然在后，普通选择器即可覆盖内置主题。
    const script = `(function(){var d=document;var n=d.getElementById("zcode-user-theme-overrides");if(!n){n=d.createElement("style");n.id="zcode-user-theme-overrides";d.head.appendChild(n);}n.textContent=${JSON.stringify(result.css)};})();`;
    void win.webContents.executeJavaScript(script, false).catch(() => {
      // 页面可能正导航或销毁；本次注入失败由下一次 did-finish-load 重放。
    });
  });
}
