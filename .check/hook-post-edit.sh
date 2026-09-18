#!/usr/bin/env bash
# hook-post-edit.sh —— 协议校验 hook 的启动器
#
# 两层理由：
#
# ① **node 的绝对路径会随版本目录变化**（…/binaries/node/versions/22.22.2-2/node.exe）。
#    写死在 settings.json 里 = 一次版本升级就**静默失效** ——
#    而静默失效比没有更坏：它让人以为这里有防护（SOUL：「重启不等于生效」）。
#
# ② **POSIX 路径必须转成 Windows 混合路径再交给 node.exe。**
#    踩过（2026-09-15）：`exec "$NODE" "$HOME/.workbuddy-ai/.check/hook-post-edit.js"`
#    里的 `$HOME` 是 `/c/Users/<user>`，node.exe 是**原生 Windows 程序**，
#    把 `/c/Users/...` 当参数收下会解析成 `C:\c\Users\...` → `MODULE_NOT_FOUND`，
#    每次都崩。**而崩掉的退出码是 1 —— 和「校验发现缺陷」的退出码一模一样。**
#    如果我只看「有没有输出」，会把三次崩溃读成「hook 工作正常，没发现问题」。
#
# 所以本启动器**永不返回非零**：跑不成也要打一行，让「没跑成」和「通过」在账面上分开。

set -u

# POSIX 路径 → C:/... 混合路径（node.exe 认得）
tomixed() { cygpath -m "$1" 2>/dev/null || printf '%s' "$1"; }

NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for c in "$HOME"/.workbuddy-ai/binaries/node/versions/*/node.exe; do
    if [ -x "$c" ]; then NODE="$c"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  echo "protocol-hook: 找不到 node（PATH 里没有，binaries 目录里也没有）—— 这一轮协议校验**没跑成**，是第三态，不是通过"
  exit 0
fi

SCRIPT="$(tomixed "$HOME")/.workbuddy-ai/.check/${1:-hook-post-edit.js}"

# 不用 exec：要让本脚本自己掌握退出码。**校验脚本崩掉 = 第三态，不许伪装成"通过"也不许伪装成"失败"。**
"$(tomixed "$NODE")" "$SCRIPT"
code=$?

if [ "$code" -ne 0 ]; then
  echo "protocol-hook: 校验脚本以退出码 $code 结束。若上面**没有** JSON 输出，说明它根本没跑起来 —— 第三态，不是通过"
fi

exit 0
