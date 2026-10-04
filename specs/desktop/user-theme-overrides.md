# Spec: 桌面端用户主题覆盖（user theme overrides）

## 背景与产品规则

ZCode 的主题体系（Zai Light / Zai Dark / System）由 CSS 变量驱动，但插件生态没有
暴露界面渲染层的扩展点，用户想微调外观（如更换 `--color-brand`、调整密度、去掉某
些视觉元素）只能 fork 源码。本特性提供一个受控逃生口：

- 用户在 `userData/ui/theme-overrides.css` 放一段 CSS，桌面端把它注入到主窗口。
- 文件不存在或读取失败时**零行为变化**，不产生告警噪音（记录 debug 级即可）。
- 覆盖样式以 author origin 注入且晚于应用内置样式表，同等特异性下自然胜出；
  需要更强覆盖时用户可自行使用更高选择器特异性或 `!important`。
- 该文件是**本机用户自主编写**的内容，信任级等同于用户自己改配置文件；不做
  内容校验（CSP 由 Electron 对 author CSS 的处理兜底），不引入远程加载。

## 状态所有者

- `theme-overrides.css` 文件的所有者是终端用户；主进程只读。
- 注入状态的所有者是主进程 `userThemeOverrides` 模块；renderer 不感知该机制存在。
- 每次主 frame `did-finish-load` 时重新读取文件并注入：
  - 注入仅对当前这次页面加载生效（Electron insertCSS 语义），
    因此导航/刷新后自动重放，无需缓存失效逻辑；
  - 用户改文件后刷新窗口（Ctrl/Cmd+R）即可生效，无需重启应用。

## 接口

```ts
// packages/desktop/src/main/userThemeOverrides.ts
readUserThemeOverridesCss(userDataPath: string): string | null
  // 读取 <userDataPath>/ui/theme-overrides.css；>256KB 视为异常返回 null。

attachUserThemeOverrides(win: BrowserWindow, deps: {
  getUserDataPath: () => string;
  logger: { warn: (...args: unknown[]) => void };
}): void
  // 在 win.webContents 的每个 did-finish-load 上读取并 insertCSS。
```

- 约束：仅主进程实现；不新增 IPC 通道、不改 renderer 与 shared 协议；
  只作用于 `createBrowserWindow` 创建的宿主窗口，不影响 webview guest。

## 验收场景

1. 文件不存在 → 窗口加载无任何注入，无 warn。
2. 文件包含 `.theme-zai-dark { --color-brand: red; }` → 暗色主题下品牌色变红，
   刷新窗口后仍生效。
3. 文件在会话中被修改 → 刷新窗口后新内容生效（无需重启）。
4. 文件 >256KB → 跳过注入并 warn 一次。
5. Web 端（packages/web）不受影响。
