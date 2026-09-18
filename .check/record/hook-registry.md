# 宿主 hook 登记表（ISS-114 ① · 「某一个 hook 静默失效」的门禁）

- 判据：`.check/host-log.js` 的 `judgeHookRegistry(byHook, text)`（**纯函数**，自带自测）
- 接线：`.check/acceptance.js` 的 **[99] hook 被宿主调用**
- 登记格式：`| \`<脚本名>\` | <事件> | 必须 / 允许缺席 | <理由> |`

## 为什么需要它（ISS-114 ①）

`[99]` 原来只报 `mine` —— 「cmd 里含 `.check/` 的 spawn **总数**」。
**只要任何一个** `.check/` hook 在跑它就 > 0，所以「**某一个**登记在册的 hook
静默失效」**看不见**（`hook-session-start.js` 从未被加载就是这样被漏掉的）。

## 铁律（与 `exit-codes.md` 同族）

1. **不得为了让检查变绿而把「必须」改成「允许缺席」**（DEC-026 家族）。
2. 每条「允许缺席」**必须写理由**；判据会逐条打印。
3. 登记了「必须」却在窗口内**一次都没出现** → 判 **FAIL**。
4. **名单只登记「本窗口的宿主会执行的」hook** —— 别的产品的配置写进来会造**假红**
   （`[99]` 注释里警告过的「新的假红面」）。
5. 判据对 `byHook` 里**不在本表**的项**只报告、不判红** —— 否则每次插件更新都会红。

## 登记

| hook 脚本 | 事件 | 期望 | 理由 |
|---|---|---|---|
| `immunity-hook.js` | PostToolUse（Write/Edit/MultiEdit） | **必须** | 登记在 `~/.workbuddy-ai/settings.json`（**本窗口的宿主**）；**每次编辑触发** → 只要窗口内有编辑就必有 spawn。实测 W23 J18 · 09-17 窗口 **21** 次。 |
| `hook-post-edit.sh` | PostToolUse | **允许缺席** | 它登记在 **`~/.codebuddy/settings.json`** —— 那是**另一个产品**的配置，**WorkBuddy 宿主不执行它**。写成「必须」就是造**假红**。 |
| `hook-session-start.js` | SessionStart | **允许缺席** | 同上（登记在 `~/.codebuddy/settings.json`）；且 **DEC-041** 已裁决「**不再要求被加载**」。 |
| `setup.sh` | 插件 hook | **允许缺席** | **不在本项目配置里** —— 由插件机制注册（实测出现 2 次）。它的缺席不构成本项目的失效。 |

## 未登记却在跑的 hook

见铁律 5：**只报告**。实测本窗口 `byHook` 只有 `immunity-hook.js` 与 `setup.sh` ——
**未登记项 0 个**。
