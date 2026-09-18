#!/usr/bin/env bash
# I5 v3 双向测（重写版）
# 用法: i5-bidirectional-test.sh <repo根> <判据js> <临时目录>
# 退出码: 0 = 全部符合预期；1 = 有不符合
#
# v1 的三个缺陷（W9 独立验收判 FAIL），本版逐条修：
#   ① 「5 形状各自独立」不成立 —— R1/R2 同因、悬空豁免从未被独立证明
#      → 本版每个红灯用例都断言「期望标记在」+「不该出现的标记不在」，并逐案隔离豁免表
#   ② C2 隔离自检只哈希**路径清单**，改内容不敏感 = 假保证
#      → 本版改为哈希**文件内容**（md5sum 全部文件）
#   ③ 豁免表用全局固定路径，跑别的日志会伪报悬空豁免（假红）
#      → 判据已改为「豁免表与留证目录同源推导」，本版据此给每个夹具配自己的豁免表
#
# 坑：给原生 node.exe 传 /c/... 会变成 C:\c\... —— 统一 cygpath -m
#
# 【2026-09-16 加，ISS-015】三参数缺省化 + **缺参即拒跑**。
#   原版：`HOME_DIR="$1"; JUDGE="$2"; TMP="$3"` —— **缺参不报错，继续跑**。
#   实测（9/16 08:2x）裸跑 `bash .check/tests/i5-bidirectional-test.sh`（无参数）：
#     `cygpath: can't convert empty path` · `mkdir: cannot create directory ''`
#     夹具落到 `/r1` `/r3` 之类根目录 · `cp: cannot stat '/.check/record/...'`
#     → 最后打印 **「双向测结论: 有 73 项失败」**。
#   那不是判据的缺陷，是**测试在拿不到参数时不拒跑** —— 把「根本没跑成」
#   伪装成「跑了 73 条红灯」。一条会这样撒谎的测试比没有测试更坏：
#   它会训练人忽略红色（同族：hook 夹具写真 TRACE，见 MEMORY）。
#   修法两条：① 参数可省，按脚本自身位置推导；② 推导结果不自洽就 **exit 2 拒跑**，
#   绝不进入断言循环 —— 拒跑与失败是两件事，退出码必须分开（0/1/2）。
#
# 【2026-09-16 加，W9 第四轮 F-F】临时目录的守门人**自相矛盾**：
#   守门人要求 `[ -d "$TMP" ]`，而脚本下一行就 `rm -rf "$TMP"` 重建 ——
#   它要求的东西被它自己删掉。传一个「尚未创建的合法路径」→ EXIT=2（W9 探针实测）。
#   修法：守门人只判「参数非空」；**可用性挪到真正要用它的地方**（rm 得掉 + mkdir 得出）。
#   ★ 这与 ISS-015/N4 是同一个母题的两面：**守门人自己也会撒谎，而且更难看见** ——
#     它撒的不是「失败」，是「拒跑」，而「拒跑」看起来永远像「我调用方式不对」。
#
# 【2026-09-16 加，W9 第四轮 F-A/F-A2/F-C】新增 R30/R31/R32：
#   R30 数值域（`2026-13-45T99:99:99Z` 形状全对但日期不存在 → 曾被判 OK）
#   R31 NaN 吞掉相邻比较（真实乱序藏在被跳过的两组里 → 曾报「非降」）
#   R32 指向目录必须 OK 且逐条点名（**对 F-C 结论的分歧**，理由见用例处）
SELF_DIR=$(cd "$(dirname "$0")" && pwd)
HOME_DIR="${1:-$(cd "$SELF_DIR/../.." && pwd)}"
JUDGE="${2:-$HOME_DIR/.check/andyngo-integrity.js}"
TMP="${3:-$(mktemp -d)}"

# 夹具的**数据源**：本测试把它们复制进夹具再改，所以它们必须真实存在。
# v3.3（修 W9 N4）：**这三个硬编码路径原先没有任何存在性检查**。
#   W9 复现：造一个「形状对但缺文件」的记录根（只有 `eventlog/` 目录 + 今天的空日志），
#   脚本通过 `-d` 目录检查后继续跑；脚本无 `set -e`，`cp`/`sed` 的失败**被吞掉**，
#   最后打印 **「双向测结论: 有 11 项失败」EXIT=1**。
#   → 「把没跑成报成 N 条红灯」这个形状**仍然可达**，只是触发条件从「无参数」
#     换成了「记录根形状对但缺文件」。**上一次我只堵了一半。**
#   修法：数据源也纳入拒跑条件。**缺数据源 = 没跑成 = exit 2，不是失败。**
REAL_LOG="$HOME_DIR/.check/record/eventlog/2026-09-15.txt"
REAL_EX="$HOME_DIR/.check/record/exemptions/2026-09-15.md"
REAL_EVDIR="$HOME_DIR/.check/record/evidence/2026-09-15"

miss=""
[ -d "$HOME_DIR/.check/record/eventlog" ] || miss="$miss 记录根($HOME_DIR)"
[ -f "$JUDGE" ]                           || miss="$miss 判据($JUDGE)"
[ -f "$REAL_LOG" ]                        || miss="$miss 真日志($REAL_LOG)"
[ -f "$REAL_EX" ]                         || miss="$miss 真豁免表($REAL_EX)"
[ -d "$REAL_EVDIR" ]                      || miss="$miss 真留证目录($REAL_EVDIR)"
# v3.4（修 W9 第四轮 F-F）：临时目录**不要求预先存在** —— 下面紧接着就 `rm -rf "$TMP"` 重建。
#   原先守门人写 `[ ! -d "$TMP" ]`，而它要求的东西**下一行就被脚本自己删掉**：
#   传一个「还没创建的合法路径」反而被判拒跑 —— **守门人自相矛盾**。
#   （W9 探针：`TMP=$TMPDIR/never-created-$$` → EXIT=2）
#   正确做法：守门人只判「参数非空」；**可用性在真正要用它的地方验**（见下面的 rm/mkdir）。
if [ -z "$TMP" ]; then miss="$miss 临时目录('$TMP' 为空)"; fi
if [ -n "$miss" ]; then
  echo "SKIP 定位不到：$miss" >&2
  echo "     拒绝在错的路径上跑出一片假红灯 —— 缺数据源是「没跑成」，不是「跑了且不合格」" >&2
  exit 2
fi
JUDGE_W=$(cygpath -m "$JUDGE")
LOG_W=$(cygpath -m "$REAL_LOG")

fail=0
skipped=0
pass() { echo "  [PASS] $1"; }
bad()  { echo "  [FAIL] $1"; fail=$((fail+1)); }

# 临时目录的**可用性**在这里验（删得掉 + 建得出），失败即拒跑。
#   不放在守门人里验「是否已存在」—— 那会和这一行的 `rm -rf` 直接打架（F-F）。
if ! rm -rf "$TMP" 2>/dev/null || ! mkdir -p "$TMP" 2>/dev/null; then
  echo "SKIP 临时目录不可用（删不掉或建不出）: $TMP" >&2
  echo "     拒绝在错的路径上跑出一片假红灯" >&2
  exit 2
fi

i5() { node "$JUDGE_W" "$1" 2>&1 | grep -E '^\[I5\]'; }
rc() { node "$JUDGE_W" "$1" >/dev/null 2>&1; echo $?; }
# 断言：rc 相符 + 该出现的标记出现 + 不该出现的标记一个都没有
# must / mustnot 用 `|` 分隔（**不是空格** —— 空格会把 "EVT 005" 拆成两个 token，永远误报）
# 前置：I1–I4 必须全 OK。否则 rc 里混进非 I5 的 FAIL，「rc 相符」就可能是别的判据顶替的假绿
#       —— R11 首跑正是这样：I5 报 OK 而 rc=1（I3 顶替），断言却"通过"了。
assert() { # $1=用例名 $2=log(win) $3=期望rc $4=必须包含(|分隔) $5=必须不包含(|分隔)
  local name="$1" log="$2" want="$3" must="$4" mustnot="$5" line r full pre
  full=$(node "$JUDGE_W" "$log" 2>&1)
  line=$(echo "$full" | grep -E '^\[I5\]')
  r=$(rc "$log")
  echo "  $line"
  echo "  RC=$r（期望 $want）"
  # v3.4：把 I6/I7 也纳入前置检查面。
  #   v3.6 给判据加了 I6/I7，而这里仍只查 I1–I4 —— 若夹具让 I6/I7 判 FAIL，
  #   rc 里就混进非 I5 的 FAIL，而前置断言**看不见**（R11 那类「别的判据顶替 rc」的假绿）。
  #   **加了判据却没加检查面，是同一种「改动只落在一条路径上」。**
  # v3.5（修 W9 第五轮 F-H5）：**按列位置读状态，不按子串**。
  #   原写法 `grep -vc ' OK '` 数的是「**不含子串 ` OK `** 的行」—— detail 里出现 ` OK ` 的
  #   FAIL 行会被**漏数**（假绿）。
  #   ★ 而我第一版"修复"是把子串从 ` OK ` 换成 `(FAIL|UNVERIFIED)` —— **当场被自己的夹具打回**：
  #     `[I6] status 取值合法  OK  全部 status ∈ {OK/**FAIL**/ASK/PROGRESS/BLOCK}` 里的 `FAIL`
  #     让**每一条** OK 行都被算成非 OK → 21 条假红。
  #   **换一个子串不是修法。** detail 是自由文本，任何子串都可能在里面出现。
  #   判据的输出格式是固定的（`[Ix] ` + name.padEnd(26) + state.padEnd(12) + detail），
  #   所以**状态就在第 31 列起**（`[I1] ` 5 列 + 名字补齐 26 列）—— 按位置取，不猜内容。
  #   （用 node 而不是 awk/grep：JS 的 padEnd 按**码元**补齐，node 的 slice 也按码元 ——
  #    同一套语义；grep 的 `.` 在不同 locale 下按字节或字符，数不准中文名字。）
  pre=$(printf '%s\n' "$full" | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  const n = s.split("\n")
    .filter((l) => /^\[I[0-9]+\]/.test(l) && !/^\[I5\]/.test(l))
    .filter((l) => /^(FAIL|UNVERIFIED)$/.test(l.slice(31, 43).trim()))
    .length;
  console.log(n);
});')
  [ "$pre" = "0" ] && pass "$name I1–I4 + I6/I7 全 OK（rc 只反映 I5）" || bad "$name I1–I4 + I6/I7 有 $pre 条非 OK → rc 断言被污染"
  [ "$r" = "$want" ] && pass "$name rc" || bad "$name rc=$r 期望 $want"
  local IFS='|'
  for m in $must; do
    [ -z "$m" ] && continue
    echo "$line" | grep -q "$m" && pass "$name 含「$m」" || bad "$name 缺「$m」"
  done
  for m in $mustnot; do
    [ -z "$m" ] && continue
    echo "$line" | grep -q "$m" && bad "$name 不该含「$m」" || pass "$name 不含「$m」"
  done
}
# 对整个输出断言（不限 I5 行）—— 用于 I1/I3/I4 的用例，那些用例的 rc 本就被别的判据影响
assert_raw() { # $1=用例名 $2=log $3=期望rc $4=必须包含(|分隔) $5=必须不包含(|分隔)
  local name="$1" log="$2" want="$3" must="$4" mustnot="$5" full r
  full=$(node "$JUDGE_W" "$log" 2>&1); r=$(rc "$log")
  echo "$full" | grep -E '^\[I'
  echo "  RC=$r（期望 $want）"
  [ "$r" = "$want" ] && pass "$name rc" || bad "$name rc=$r 期望 $want"
  local IFS='|'
  for m in $must; do
    [ -z "$m" ] && continue
    echo "$full" | grep -qE "$m" && pass "$name 含「$m」" || bad "$name 缺「$m」"
  done
  for m in $mustnot; do
    [ -z "$m" ] && continue
    echo "$full" | grep -qE "$m" && bad "$name 不该含「$m」" || pass "$name 不含「$m」"
  done
}
# 夹具：日志 + 证据目录 + **自己的**豁免表（同源推导）
FIX=""
seed() { # $1=夹具根  $2=日志来源(默认真日志)
  FIX="$1"
  mkdir -p "$1/record/eventlog" "$1/record/evidence/2026-09-15" "$1/record/exemptions"
  cp "${2:-$REAL_LOG}" "$1/record/eventlog/2026-09-15.txt"
  cp "$REAL_EX" "$1/record/exemptions/2026-09-15.md"
  find "$REAL_EVDIR" -maxdepth 1 -type f -exec cp {} "$1/record/evidence/2026-09-15/" \;
  # 把日志里的 HOME 相对路径改写为**夹具内绝对路径**：
  #   I3 按真 HOME 解析相对路径（碰巧能过），而 D6 会判「不在本夹具的留证目录内」→ 假红。
  #   夹具必须自洽：日志里的留证路径、留证目录、豁免表都在同一个夹具根下。
  local W; W=$(cygpath -m "$1")
  sed -i "s|\.check/record/evidence/2026-09-15/|$W/record/evidence/2026-09-15/|g" "$1/record/eventlog/2026-09-15.txt"
}
# 自定义日志夹具：**豁免表清空 + 留证目录清空**
# 不清豁免表 → 真表里的 EVT 005/007 在自定义日志里变成悬空豁免，污染用例
# 不清留证目录 → 真目录里的 7 个合规文件在自定义日志里全成孤儿，D2 淹掉一切
# （W9 独立验收正是抓到了「多标记共触发」：R4/R5/R6 都混进了伪悬空）
seed_c() { # $1=夹具根
  FIX="$1"
  mkdir -p "$1/record/eventlog" "$1/record/evidence/2026-09-15" "$1/record/exemptions"
  : > "$1/record/eventlog/2026-09-15.txt"
  : > "$1/record/exemptions/2026-09-15.md"
}
FW() { cygpath -m "$1/record/eventlog/2026-09-15.txt"; }
# I3 是 `path.join(HOME, ev)`，而 HOME 是**真仓库根**，不是夹具根。
# 夹具若写相对路径，I3 会跑去真仓库找 → FAIL → rc 被 I5 之外的因素顶替（假绿）。
# 故一律给**夹具内绝对路径**。
EV() { printf '%s\n' "$(cygpath -m "$FIX/record/evidence/2026-09-15/$1")"; }

echo "===== I5 v3 双向测 ====="
NONE="D1|D2|D3|D4|D5|悬空豁免"

echo
echo "--- G1 该绿的绿：真事件流 + 真豁免表 ---"
assert "G1" "$LOG_W" 0 "双向单射成立" "$NONE"

echo
echo "--- R1 D3：豁免表缺失 → 必须点名 EVT 005 与 EVT 007 ---"
seed "$TMP/r1"; rm "$TMP/r1/record/exemptions/2026-09-15.md"
assert "R1" "$(FW "$TMP/r1")" 1 "D3|EVT 005|EVT 007" "D1|D2|D4|D5|悬空豁免"

echo
echo "--- R2 D3：在真日志上新增一行、留证不合约定 → 只点名新行（005/007 仍被豁免）---"
echo "    seq 动态取「真日志行数+1」：硬编码 010 会在真日志长到 10 行时撞号 → I2 FAIL 顶替 rc（实测踩到）"
seed "$TMP/r2"
NEXT=$(printf '%03d' $(( $(grep -c '^EVT ' "$TMP/r2/record/eventlog/2026-09-15.txt") + 1 )))
printf 'x\n' > "$TMP/r2/record/evidence/2026-09-15/eventlog-verifytest-135358.txt"
printf 'EVT %s 2026-09-15T23:59:59Z W10 J1 OK -- %s\n' "$NEXT" "$(EV eventlog-verifytest-135358.txt)" >> "$(FW "$TMP/r2")"
assert "R2" "$(FW "$TMP/r2")" 1 "D3|EVT $NEXT" "D1|D2|D4|D5|悬空豁免|EVT 005"

echo
echo "--- R3 D2孤儿：留证目录多一个无人引用的合规文件（非空）---"
seed "$TMP/r3"; printf 'x\n' > "$TMP/r3/record/evidence/2026-09-15/w9-j9-orphan.txt"
assert "R3" "$(FW "$TMP/r3")" 1 "D2|孤儿|w9-j9-orphan.txt" "D1|D3|D4|D5|悬空豁免"

echo
echo "--- R4 D2重复：两行引用同一留证（两行同为 W1 J1，避免触发 D4）---"
seed_c "$TMP/r4"; printf 'x\n' > "$TMP/r4/record/evidence/2026-09-15/w1-j1-probe.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(EV w1-j1-probe.txt)" > "$(FW "$TMP/r4")"
printf 'EVT 002 2026-09-15T13:53:59Z W1 J1 OK -- %s\n' "$(EV w1-j1-probe.txt)" >> "$(FW "$TMP/r4")"
assert "R4" "$(FW "$TMP/r4")" 1 "D2|被重复引用|w1-j1-probe.txt" "D1|D3|D4|D5|悬空豁免|孤儿"

echo
echo "--- R5 D1：某行无留证（另一行正常引用，避免 D2 孤儿共触发）---"
seed_c "$TMP/r5"; printf 'x\n' > "$TMP/r5/record/evidence/2026-09-15/w1-j1-probe.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(EV w1-j1-probe.txt)" > "$(FW "$TMP/r5")"
printf 'EVT 002 2026-09-15T13:53:59Z W1 J2 OK -- --\n' >> "$(FW "$TMP/r5")"
assert "R5" "$(FW "$TMP/r5")" 1 "D1|EVT 002" "D2|D3|D4|D5|悬空豁免"

echo
echo "--- R6 悬空豁免：全部行合规 + 豁免表登记一条不存在的行 → 只有悬空豁免 ---"
seed_c "$TMP/r6"; printf 'x\n' > "$TMP/r6/record/evidence/2026-09-15/w1-j1-probe.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(EV w1-j1-probe.txt)" > "$(FW "$TMP/r6")"
printf 'EX-099 EVT 099 2026-09-15T14:40Z 故意造的悬空豁免\n' > "$TMP/r6/record/exemptions/2026-09-15.md"
assert "R6" "$(FW "$TMP/r6")" 1 "悬空豁免|099" "D1|D2|D3|D4|D5"

echo
echo "--- R7 留证在目录外（v3.2 起由 D6 接住）：行指向的合规名文件在留证目录**之外** ---"
echo "    修前（v3.1）：A=0 → 报 UNVERIFIED(2)，即「判不了」；加 D6 后变成「判出错」(1)"
seed_c "$TMP/r7"; mkdir -p "$TMP/r7/outside"; printf 'x\n' > "$TMP/r7/outside/w1-j1-elsewhere.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(cygpath -m "$TMP/r7/outside/w1-j1-elsewhere.txt")" > "$(FW "$TMP/r7")"
assert "R7" "$(FW "$TMP/r7")" 1 "D6|目录内" "D1|D2|D3|D4|D5|悬空豁免|双向单射成立"

echo
echo "--- R8 D4：文件名合规但 wave/job 与行不符（行 W3 J1 指向 w1-j1-…）---"
seed_c "$TMP/r8"; printf 'x\n' > "$TMP/r8/record/evidence/2026-09-15/w1-j1-probe.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W3 J1 OK -- %s\n' "$(EV w1-j1-probe.txt)" > "$(FW "$TMP/r8")"
assert "R8" "$(FW "$TMP/r8")" 1 "D4|W3 J1" "D1|D2|D3|D5|悬空豁免"

echo
echo "--- R9 D5：零字节留证 = 没留证 ---"
seed_c "$TMP/r9"; : > "$TMP/r9/record/evidence/2026-09-15/w1-j1-empty.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(EV w1-j1-empty.txt)" > "$(FW "$TMP/r9")"
assert "R9" "$(FW "$TMP/r9")" 1 "D5|零字节|w1-j1-empty.txt" "D1|D2|D3|D4|悬空豁免"

echo
echo "--- R10 松豁免：豁免只写 EVT 号、不写留证文件名 → 不认，D3 报（且**不**另报悬空豁免）---"
seed_c "$TMP/r10"; printf 'x\n' > "$TMP/r10/record/evidence/2026-09-15/w1-j2-ok.txt"
printf 'x\n' > "$TMP/r10/record/evidence/2026-09-15/eventlog-verifytest-135358.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(EV eventlog-verifytest-135358.txt)" > "$(FW "$TMP/r10")"
printf 'EVT 002 2026-09-15T13:53:59Z W1 J2 OK -- %s\n' "$(EV w1-j2-ok.txt)" >> "$(FW "$TMP/r10")"
printf 'EX-001 EVT 001 2026-09-15T14:40Z 只写号码不写文件名，应当不被承认\n' > "$TMP/r10/record/exemptions/2026-09-15.md"
# 「豁免不生效」是**一条**事实：D3 报它（并附注登记不生效的原因）。
# 若再报一次「悬空豁免」= 双重计数 —— v3.1 已把悬空豁免收窄为「seq 不在事件流」。
assert "R10" "$(FW "$TMP/r10")" 1 "D3|EVT 001|登记不生效" "D1|D2|D4|D5|悬空豁免|白登记"

echo
echo "--- R11 无效豁免（v3.1 新增空档）：行留证**本身合规** + 豁免没指名 → 白登记，必须报 ---"
echo "    修前这是假绿：D3 不管（base 合规）、悬空豁免不管（seq 在）→ 登记无效却零信号"
seed_c "$TMP/r11"; printf 'x\n' > "$TMP/r11/record/evidence/2026-09-15/w1-j1-ok.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$(EV w1-j1-ok.txt)" > "$(FW "$TMP/r11")"
printf 'EX-001 EVT 001 2026-09-15T14:40Z 只写号码不写文件名（而该行本来合规）\n' > "$TMP/r11/record/exemptions/2026-09-15.md"
assert "R11" "$(FW "$TMP/r11")" 1 "无效豁免|白登记" "D1|D2|D3|D4|D5|悬空豁免"

echo
echo "--- R12 子串冒领（v3.1）：登记写 r2-...txt.bak，行引用 r2-...txt → 不是同一 token，不认 ---"
echo "    修前这是假绿：exCovers 用 indexOf 子串匹配 → 更长的名字把短名字的豁免冒领走"
seed_c "$TMP/r12"; printf 'x\n' > "$TMP/r12/record/evidence/2026-09-15/r2-card-coverage-220801.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W5 J1 OK -- %s\n' "$(EV r2-card-coverage-220801.txt)" > "$(FW "$TMP/r12")"
printf 'EX-001 EVT 001 2026-09-15T14:40Z 登记里写的是 r2-card-coverage-220801.txt.bak，不是同一个 token\n' > "$TMP/r12/record/exemptions/2026-09-15.md"
assert "R12" "$(FW "$TMP/r12")" 1 "D3|EVT 001|登记不生效" "D1|D2|D4|D5|悬空豁免|白登记"

echo
echo "--- R13 重复登记（v3.1）：同一 seq 登记两次 → 后者静默顶掉前者，必须报 ---"
seed_c "$TMP/r13"; printf 'x\n' > "$TMP/r13/record/evidence/2026-09-15/r2-card-coverage-220801.txt"
printf 'EVT 001 2026-09-15T13:53:58Z W5 J1 OK -- %s\n' "$(EV r2-card-coverage-220801.txt)" > "$(FW "$TMP/r13")"
printf 'EX-001 EVT 001 2026-09-15T14:40Z 第一次登记：r2-card-coverage-220801.txt\n' > "$TMP/r13/record/exemptions/2026-09-15.md"
printf 'EX-002 EVT 001 2026-09-15T14:41Z 第二次登记：r2-card-coverage-220801.txt\n' >> "$TMP/r13/record/exemptions/2026-09-15.md"
assert "R13" "$(FW "$TMP/r13")" 1 "重复登记|001" "D1|D2|D3|D4|D5|悬空豁免|白登记"

echo
echo "--- R14 共用目录外留证（W9 F1 核心场景）：两行同指一份目录外留证 ---"
echo "    修前判 OK（A 扫不到目录外的文件 → D2 的查重对它失效）；修后必须 D6 + D2 双报"
seed_c "$TMP/r14"; mkdir -p "$TMP/r14/outside"
printf 'x\n' > "$TMP/r14/outside/w1-j1-shared.txt"
printf 'x\n' > "$TMP/r14/record/evidence/2026-09-15/w9-j9-z.txt"
SH=$(cygpath -m "$TMP/r14/outside/w1-j1-shared.txt")
printf 'EVT 001 2026-09-15T13:53:58Z W1 J1 OK -- %s\n' "$SH" > "$(FW "$TMP/r14")"
printf 'EVT 002 2026-09-15T13:53:59Z W1 J1 OK -- %s\n' "$SH" >> "$(FW "$TMP/r14")"
printf 'EVT 003 2026-09-15T13:54:00Z W9 J9 OK -- %s\n' "$(EV w9-j9-z.txt)" >> "$(FW "$TMP/r14")"
assert "R14" "$(FW "$TMP/r14")" 1 "D6|D2|被重复引用|w1-j1-shared.txt" "D1|D3|D4|D5|悬空豁免|双向单射成立"

echo
echo "--- R15 I4 假绿（W9 F2）：ts 小时不补零 → 字符串比较失真（'9' > '1' 误判为递增）---"
echo "    真实时间 13:00 → 09:00 是**递减**，必须 FAIL"
echo "    v3.6 起该形状由**格式校验**拦下（要求 hh 两位），报「格式不合·形状」而非「无法解析」——"
echo "    断言随之更新：**判据换了拦截层，测试若还找旧字样，就会变成一条永远红的断言**"
echo "    ★ v3.7 再修一处更隐蔽的：mustnot 原写「格式合规」，而 v3.6 的 OK 文案已改成"
echo "      「形状合规、数值合法且非降」→ 这条 mustnot **永远不可能命中 = 悄悄变成空断言**"
echo "      （永远红的断言会被看见，永远绿的断言不会）。故改为「数值合法」。"
seed_c "$TMP/r15"; printf 'x\n' > "$TMP/r15/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r15")"
printf 'EVT 002 2026-09-15T9:00:00Z W1 J2 OK -- %s\n' "$(EV w1-j2-b.txt)" >> "$(FW "$TMP/r15")"
printf 'x\n' > "$TMP/r15/record/evidence/2026-09-15/w1-j2-b.txt"
assert_raw "R15" "$(FW "$TMP/r15")" 1 "I4.*FAIL|格式不合" "I4.*OK|数值合法"

echo
echo "--- R16 事件流污染（W9 F3）：插一行非 EVT → I1 必须 FAIL（原先只在附注里提一句）---"
seed_c "$TMP/r16"; printf 'x\n' > "$TMP/r16/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r16")"
printf 'GARBAGE 这行不是 EVT\n' >> "$(FW "$TMP/r16")"
assert_raw "R16" "$(FW "$TMP/r16")" 1 "I1.*FAIL|污染|GARBAGE" "I1.*OK"

echo
echo "--- R17 前导零口径一致（W9 F4）：w01-j01-x.txt 与 W1 J1 应视为**一致**，不该报 D4 ---"
echo "    修前：CONF 收它进 A，D4 又判 '01' ≠ '1' → 该文件既入 A 又必成孤儿 = 假红"
seed_c "$TMP/r17"; printf 'x\n' > "$TMP/r17/record/evidence/2026-09-15/w01-j01-x.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w01-j01-x.txt)" > "$(FW "$TMP/r17")"
assert "R17" "$(FW "$TMP/r17")" 0 "双向单射成立" "D1|D2|D3|D4|D5|D6|悬空豁免"

echo
echo "--- R18 空 slug（W9 F5）：w1-j1-.txt 无 slug → 不算合规留证，必须 D3 报 ---"
seed_c "$TMP/r18"; printf 'x\n' > "$TMP/r18/record/evidence/2026-09-15/w1-j1-.txt"
printf 'x\n' > "$TMP/r18/record/evidence/2026-09-15/w1-j2-ok.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-.txt)" > "$(FW "$TMP/r18")"
printf 'EVT 002 2026-09-15T13:00:01Z W1 J2 OK -- %s\n' "$(EV w1-j2-ok.txt)" >> "$(FW "$TMP/r18")"
assert "R18" "$(FW "$TMP/r18")" 1 "D3|EVT 001" "D1|D2|D4|D5|D6|悬空豁免"

echo
echo "--- R19 A=0 守门人仍可达：留证目录为空 + 行指向目录内**不存在**的合规名文件 ---"
echo "    D6 不报（路径在目录内）、D3 不报（名字合规）→ f5 空 → I5 必须 UNVERIFIED（不许报 OK）"
echo "    注意 I3 会独立报「文件不存在」，故整体 rc=1；本用例只针对 I5 那一行断言"
seed_c "$TMP/r19"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-ghost.txt)" > "$(FW "$TMP/r19")"
assert_raw "R19" "$(FW "$TMP/r19")" 1 "I5.*UNVERIFIED|A=0|空转" "双向单射成立"

echo
echo "--- R20 子目录走私（W9 G1，★无需任何特权即可复现的假绿）：留证放 evDir/sub/ 下 ---"
echo "    A 集用 readdirSync **只扫顶层** → 看不见它；v3.2 的 D6 是纯词法比较 → 判「在目录内」"
echo "    → 该留证根本不在 A↔B 单射里，判据却宣布「单射成立」。修后必须 D6 FAIL"
seed_c "$TMP/r20"; mkdir -p "$TMP/r20/record/evidence/2026-09-15/sub"
printf 'x\n' > "$TMP/r20/record/evidence/2026-09-15/w1-j1-ok.txt"
printf 'x\n' > "$TMP/r20/record/evidence/2026-09-15/sub/w1-j2-smuggle.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-ok.txt)" > "$(FW "$TMP/r20")"
printf 'EVT 002 2026-09-15T13:00:01Z W1 J2 OK -- %s\n' "$(EV sub/w1-j2-smuggle.txt)" >> "$(FW "$TMP/r20")"
assert "R20" "$(FW "$TMP/r20")" 1 "D6|目录内" "D1|D2|D3|D4|D5|悬空豁免|双向单射成立"

echo
echo "--- R21 I4 假红（W9 G3）：合法 ISO 变体（带毫秒 / +00:00 偏移）必须被接受 ---"
echo "    v3.2 的白名单 ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$ 把它们判成「格式不合」"
echo "    v3.3 改为解析成时间戳比较 → 自动接受一切可解析的 ISO 8601 变体"
seed_c "$TMP/r21"
printf 'x\n' > "$TMP/r21/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'x\n' > "$TMP/r21/record/evidence/2026-09-15/w1-j2-b.txt"
printf 'EVT 001 2026-09-15T13:00:00.000Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r21")"
printf 'EVT 002 2026-09-15T13:00:01+00:00 W1 J2 OK -- %s\n' "$(EV w1-j2-b.txt)" >> "$(FW "$TMP/r21")"
assert_raw "R21" "$(FW "$TMP/r21")" 0 "I4.*OK" "乱序|格式不合"

echo
echo "--- R22 D4 字段格式（W9 低危）：行 wave 写成 'W'（无数字）---"
echo "    Number('')===0 会与 w0-j1-x.txt 的 Number('0')===0 **等价而漏报** → 必须先校验字段格式"
seed_c "$TMP/r22"; printf 'x\n' > "$TMP/r22/record/evidence/2026-09-15/w0-j1-x.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W J1 OK -- %s\n' "$(EV w0-j1-x.txt)" > "$(FW "$TMP/r22")"
assert "R22" "$(FW "$TMP/r22")" 1 "D4|W J1" "D1|D2|D3|D5|D6|悬空豁免"

echo
echo "--- R23 I4 格式（W9 N1）：ts 只有日期 —— v3.3 起 Date.parse 能解析它，曾被判绿 ---"
echo "    v3.3 修 G3 时把 I4 改成「只解析」，副作用是**格式这个维度被整个丢掉**"
seed_c "$TMP/r23"; printf 'x\n' > "$TMP/r23/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15 W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r23")"
assert_raw "R23" "$(FW "$TMP/r23")" 1 "I4.*FAIL|格式不合" "数值合法"

echo
echo "--- R24 I4 格式（W9 N1）：ts 缺 Z —— 曾被按**本机时区**解析，同一份日志结论随机器变 ---"
echo "    本机 offset=-480：与 …T13:00:00Z 比大小会判「乱序」；UTC 机器上会判「非降」"
seed_c "$TMP/r24"; printf 'x\n' > "$TMP/r24/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00 W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r24")"
assert_raw "R24" "$(FW "$TMP/r24")" 1 "I4.*FAIL|格式不合" "数值合法"

echo
echo "--- R25 空判据守门人（W9 N2）：0 条 EVT + N 条垃圾 —— 必须 I1 FAIL，不许报「事件流为空」---"
echo "    原写法 `if (evtLines.length === 0)` 排在 stray 计算之后、判断之前"
echo "    → 「全是污染」被说成「文件为空」，**提示语与事实相反**（会让人以为今天还没干活）"
seed_c "$TMP/r25"
printf 'GARBAGE 只有垃圾行\nALSO-BAD 第二行\n' > "$(FW "$TMP/r25")"
assert_raw "R25" "$(FW "$TMP/r25")" 1 "I1.*FAIL|整份日志没有任何 EVT 行" "事件流为空|文件为空"

echo
echo "--- R26 D4 字段格式（W9 N5）：行写 '1 1'（无 W/J 前缀）→ 数值一致，不许报 D4 ---"
echo "    原写法要求字段必须形如 W<n>/J<n>，而 I1 给的格式并未要求前缀"
echo "    → 数值一致却报「不一致」，且**把格式错说成了不一致**（两件事混成一个标签）"
seed_c "$TMP/r26"; printf 'x\n' > "$TMP/r26/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z 1 1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r26")"
assert "R26" "$(FW "$TMP/r26")" 0 "双向单射成立" "D4|D1|D2|D3|D5|D6|悬空豁免"

echo
echo "--- R27 I6 status 合法（W9 O1）：status 乱写 → 此前被完全忽略（5 OK / 0 FAIL）---"
echo "    一列没有任何判据的字段 = 一列自由的注释"
seed_c "$TMP/r27"; printf 'x\n' > "$TMP/r27/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 GARBAGE-STATUS -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r27")"
assert_raw "R27" "$(FW "$TMP/r27")" 1 "I6.*FAIL|非法取值" "全部 status"

echo
echo "--- R28 I7 artifact_ptr 存在（W9 O1）：指向不存在的文件 → 此前被完全忽略 ---"
echo "    I3 只查 evidence_ptr；两列都是「指针」，凭什么只查一列"
seed_c "$TMP/r28"; printf 'x\n' > "$TMP/r28/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK /nonexistent/artifact.bin %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r28")"
assert_raw "R28" "$(FW "$TMP/r28")" 1 "I7.*FAIL|缺失" "全部 artifact_ptr"

echo
echo "--- R29 归因（W9 N3）：多份日志时，每条结果必须带**来源文件名** ---"
echo "    原先只打印 [id] name state detail，两个 [I1] 块分不清是哪份 = 归因错误（同族 ISS-013）"
seed_c "$TMP/r29a"; printf 'x\n' > "$TMP/r29a/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r29a")"
mkdir -p "$TMP/r29b/record/eventlog" "$TMP/r29b/record/evidence/2026-09-16" "$TMP/r29b/record/exemptions"
printf 'x\n' > "$TMP/r29b/record/evidence/2026-09-16/w1-j1-b.txt"
printf 'EVT 001 2026-09-16T13:00:00Z W1 J1 OK -- %s\n' \
  "$(cygpath -m "$TMP/r29b/record/evidence/2026-09-16/w1-j1-b.txt")" \
  > "$TMP/r29b/record/eventlog/2026-09-16.txt"
out29=$(node "$JUDGE_W" "$(FW "$TMP/r29a")" "$(cygpath -m "$TMP/r29b/record/eventlog/2026-09-16.txt")" 2>&1)
r29=$(node "$JUDGE_W" "$(FW "$TMP/r29a")" "$(cygpath -m "$TMP/r29b/record/eventlog/2026-09-16.txt")" >/dev/null 2>&1; echo $?)
echo "  RC=$r29（期望 0）"
[ "$r29" = "0" ] && pass "R29 rc" || bad "R29 rc=$r29 期望 0"
echo "$out29" | grep -q -- '--- 日志: 2026-09-15.txt ---' && pass "R29 带 09-15 来源" || bad "R29 缺 09-15 来源"
echo "$out29" | grep -q -- '--- 日志: 2026-09-16.txt ---' && pass "R29 带 09-16 来源" || bad "R29 缺 09-16 来源"

echo
echo "--- R30 I4 数值域（W9 第四轮 F-A）：形状全对但**日期/时间不存在** → 必须 FAIL ---"
echo "    \`2026-13-45T99:99:99Z\` 匹配 TS_RE（v3.6 的 TS_RE 只数位数、不看数值域）"
echo "    → Date.parse 返回 NaN → nonMono 的 !isNaN 守门把它跳过 → **判 OK**。"
echo "    真假绿：判据对「不存在的日期」说「格式合规」。另一例 \`2026-02-30\` 会被 Date.parse"
echo "    静默滚成 03-02（不报错、也不等于原文）→ 必须由**规范化回验**接住。"
seed_c "$TMP/r30"
printf 'x\n' > "$TMP/r30/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'x\n' > "$TMP/r30/record/evidence/2026-09-15/w1-j2-b.txt"
printf 'EVT 001 2026-13-45T99:99:99Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r30")"
printf 'EVT 002 2026-02-30T13:00:00Z W1 J2 OK -- %s\n' "$(EV w1-j2-b.txt)" >> "$(FW "$TMP/r30")"
assert_raw "R30" "$(FW "$TMP/r30")" 1 "I4.*FAIL|数值非法" "数值合法且非降"

echo
echo "--- R31 I4 数值域（W9 第四轮 F-A2）：非法 ts 夹在中间 → 相邻两组比较被**静默跳过** ---"
echo "    真实乱序（13:00 → 12:00）就藏在那两组里，而判据报「非降」—— 单调性在局部根本没被校验"
echo "    v3.7：NaN 显式计入格式不合，且**跳过的比较组数必须打印出来**"
echo "    （不许「因为已经 FAIL 了，就当单调性检查过了」）"
seed_c "$TMP/r31"
printf 'x\n' > "$TMP/r31/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'x\n' > "$TMP/r31/record/evidence/2026-09-15/w1-j2-b.txt"
printf 'x\n' > "$TMP/r31/record/evidence/2026-09-15/w1-j3-c.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r31")"
printf 'EVT 002 2026-13-45T99:99:99Z W1 J2 OK -- %s\n' "$(EV w1-j2-b.txt)" >> "$(FW "$TMP/r31")"
printf 'EVT 003 2026-09-15T12:00:00Z W1 J3 OK -- %s\n' "$(EV w1-j3-c.txt)" >> "$(FW "$TMP/r31")"
assert_raw "R31" "$(FW "$TMP/r31")" 1 "数值非法|跳过 2 组" "数值合法且非降"

echo
echo "--- R32 I7 口径（W9 第四轮 F-C 的**分歧点**）：指向目录 → 必须 OK，且必须逐条点名 ---"
echo "    规格原文只说「artifact_ptr = 产物路径」（event-protocol.md:13/23），**没有**限制为文件；"
echo "    真盘 EVT 002 的 \`skills/andyngo/\` 就是实例（W2 产出的是 22 个文件，产物是一棵目录树）。"
echo "    → 接受 F-C 的**机制观察**（existsSync 对目录返回 true），不接受其**结论**"
echo "      （「目录被当合法」不是缺陷）—— 判据不得发明规格没有的约束（同族 G3/N5 的过紧假红）。"
echo "    → 实质回应：目录引用**逐条点名打印**，不隐藏。"
echo "    （「指向不存在」必须仍 FAIL 的回归由 R28 覆盖，口径未被这次调整放松。）"
seed_c "$TMP/r32"
printf 'x\n' > "$TMP/r32/record/evidence/2026-09-15/w1-j1-a.txt"
mkdir -p "$TMP/r32/artifact-dir"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK %s %s\n' \
  "$(cygpath -m "$TMP/r32/artifact-dir")" "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r32")"
assert_raw "R32" "$(FW "$TMP/r32")" 0 "I7.*OK|指向\*\*目录\*\*" "缺失|既非文件也非目录"

echo
echo "--- R33 守门人自洽（W9 第四轮 F-F / 第五轮 F-H4）：传一个**尚未创建**的合法临时目录 → 必须跑 ---"
echo "    ① F-F：守门人原写 [ ! -d \"\$TMP\" ]，而脚本**下一行就 rm -rf \"\$TMP\"** ——"
echo "       守门人要求的东西被它自己删掉 → 传「还没创建的合法路径」反而被判拒跑（EXIT=2）。"
echo "    ② F-H4：我修 F-F 时用**环境变量** ANDYNGO_BIDI_NO_NEST 防递归 —— 那等于把"
echo "       「R33 跑不跑」交给一个**外部可设的变量**：export 一下就跳过本用例，"
echo "       断言数 264→263 而结论照样「全通过」—— **把没跑报成通过**（ISS-015 的同一形状）。"
echo "       且原断言只写 rc≠2 → 子进程根本没启动（rc=127）也算过。"
echo "    修法：① 防递归改用**第 4 个位置参数** --no-nest（环境变量设不了它）；"
echo "          ② 断言 rc ∈ {0,1} **且**子进程输出里必须有结论行（证明它真的跑完）。"
NEWTMP="$TMP/r33-never-created-$$"
if [ -e "$NEWTMP" ]; then bad "R33 前置：$NEWTMP 竟已存在"; else pass "R33 前置：目标目录尚未创建"; fi
if [ "${4:-}" = "--no-nest" ]; then
  echo "  [SKIP] R33 —— 本次是嵌套调用（第 4 参数 --no-nest），跳过再次嵌套以防无限递归"
  skipped=$((skipped+1))
else
  OUT33="$TMP/r33-child.out"
  bash "$SELF_DIR/i5-bidirectional-test.sh" "$HOME_DIR" "$JUDGE" "$NEWTMP" --no-nest > "$OUT33" 2>&1
  r33=$?
  echo "  RC=$r33（期望 0 或 1；2=拒跑，126/127=子进程根本没启动）"
  case "$r33" in
    0|1) pass "R33 未拒跑（未创建的临时目录被接受，守门人不再自相矛盾）" ;;
    *)   bad "R33 rc=$r33 —— 期望 0/1；2=守门人仍在拒绝它自己会创建的目录，126/127=子进程没启动" ;;
  esac
  if grep -q '双向测结论' "$OUT33"; then
    pass "R33 子进程真的跑完了（输出含结论行）"
  else
    bad "R33 子进程没有产出结论行 → 「没跑成」被当成了「没拒跑」"
  fi
fi

echo
echo "--- R34 I3 口径（W9 第五轮 F-H1）：evidence_ptr 指向**目录** → I3 必须 OK（存在性归 I3）---"
echo "    规格 event-protocol.md:14/24 只说「必须真实存在」，**没有说必须是文件**。"
echo "    v3.7 我为「与 I7 对称」给 I3 加了 isFile —— **同一个改动里犯的同一个错**"
echo "    （I7 放宽、I3 收紧）。而「留证必须是**非空文件**」这条约束归 **D5**（证据的门槛），"
echo "    不归 I3（路径存在性）—— 归位后同时消掉 I3 与 D5 的**双重计数**。"
echo "    另：D5 的标签必须精确 —— 目录不是「零字节」，它根本不是文件。"
seed_c "$TMP/r34"
mkdir -p "$TMP/r34/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 OK -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r34")"
assert_raw "R34" "$(FW "$TMP/r34")" 1 "I3.*OK|D5.*是目录" "I3.*FAIL|零字节"

echo
echo "--- R35 I6 口径（W9 第五轮 F-H2）：PROGRESS / ASK 必须 **OK**（SKILL.md:60/61 明文授权）---"
echo "    event-protocol.md:12/26 只写三态 OK/FAIL/BLOCK，SKILL.md:60 写五态 —— **规格内部不一致**。"
echo "    按 DEC-006「取超集、不删名字」：收紧到三态会让**明文授权**的值变假红"
echo "    （同族 G3 / N5 / F-C / F-H1 的过紧假红）。故保留五态，但**写明枚举出处与冲突**（ISS-035）。"
echo "    注意这不是「不可证伪」：R27 已证明它对 GARBAGE-STATUS 报红。"
echo "    ★ mustnot 用「非法取值」而不是「I6.*FAIL」—— **`I6.*FAIL` 对本判据永远不可靠**："
echo "      I6 的 OK detail 必然列出枚举 `{OK/**FAIL**/ASK/PROGRESS/BLOCK}`，"
echo "      所以 `I6.*FAIL` 在**通过时也会命中**（我第一版就是这么写的，当场被自己的夹具打回）。"
echo "      **同 R36：detail 是自由文本，任何状态词都可能在里面出现 —— 负向断言必须用该分支的专有字样。**"
seed_c "$TMP/r35"
printf 'x\n' > "$TMP/r35/record/evidence/2026-09-15/w1-j1-a.txt"
printf 'x\n' > "$TMP/r35/record/evidence/2026-09-15/w1-j2-b.txt"
printf 'EVT 001 2026-09-15T13:00:00Z W1 J1 PROGRESS -- %s\n' "$(EV w1-j1-a.txt)" > "$(FW "$TMP/r35")"
printf 'EVT 002 2026-09-15T13:00:01Z W1 J2 ASK -- %s\n' "$(EV w1-j2-b.txt)" >> "$(FW "$TMP/r35")"
assert_raw "R35" "$(FW "$TMP/r35")" 0 "I6.*OK" "非法取值"

echo
echo "--- R36 元断言（W9 第五轮 F-H5）：状态必须**按列位置**读 —— 换一个子串不是修法 ---"
echo "    口径一 `grep -vc ' OK '`：数「不含子串 ' OK ' 的行」→ detail 里出现 ' OK ' 的 FAIL 行被**漏数**。"
echo "    口径二 `grep -cE '(FAIL|UNVERIFIED)'`（我第一版"修复"）：被 detail 里的"
echo "    `{OK/FAIL/ASK/PROGRESS/BLOCK}` 骗到 → **每一条 OK 行都算非 OK** → 21 条假红。"
echo "    口径三（现行）：判据输出格式固定，状态就在第 31 列起，**按位置取**。"
echo "    这条元断言把三个口径放在同一段合成输出上跑，**必须只有口径三是对的**。"
S36=$(printf '[I6] status 取值合法           OK          全部 status ∈ {OK/FAIL/ASK/PROGRESS/BLOCK}\n[I1] 字段数 = 8（无非 EVT 行）         FAIL        另有 1 行不以 EVT 开头: "GARBAGE OK LINE"\n')
old36=$(printf '%s\n' "$S36" | grep -E '^\[I(1|2|3|4|6|7)\]' | grep -vc ' OK ')
mid36=$(printf '%s\n' "$S36" | grep -E '^\[I(1|2|3|4|6|7)\]' | grep -cE '(FAIL|UNVERIFIED)')
new36=$(printf '%s\n' "$S36" | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  const n = s.split("\n").filter((l) => /^\[I[0-9]+\]/.test(l) && !/^\[I5\]/.test(l))
    .filter((l) => /^(FAIL|UNVERIFIED)$/.test(l.slice(31, 43).trim())).length;
  console.log(n);
});')
echo "  真值应为 1（一条 FAIL）"
echo "  口径一 pre=$old36（漏数：detail 里的 ' OK ' 把 FAIL 行洗白了）"
echo "  口径二 pre=$mid36（假红：枚举表里的 'FAIL' 把 OK 行染红了）"
echo "  口径三 pre=$new36（应为 1）"
[ "$new36" = "1" ] && pass "R36 口径三正确数出 1 条非 OK" || bad "R36 口径三 pre=$new36 期望 1"
[ "$old36" = "0" ] && pass "R36 口径一确实漏数（证明修复必要）" || bad "R36 口径一 pre=$old36 —— 与预期不符，请复核这条修复的前提"
[ "$mid36" = "2" ] && pass "R36 口径二确实假红（证明「换子串」不是修法）" || bad "R36 口径二 pre=$mid36 期望 2 —— 与预期不符，请复核这条修复的前提"

echo
echo "--- C1 反向复现：撤掉全部夹具，真事件流必须回到 rc=0 ---"
r=$(rc "$LOG_W"); echo "  RC=$r"
[ "$r" -eq 0 ] && pass "回到全绿 —— 红灯确由夹具造成，非判据常红" || bad "RC=$r 期望 0"

echo
echo "--- C2 夹具隔离（**哈希内容**，不是路径清单）---"
BEFORE=$(find "$HOME_DIR/.check/record" -type f -exec md5sum {} + | sort | md5sum | cut -d' ' -f1)
i5 "$LOG_W" >/dev/null
AFTER=$(find "$HOME_DIR/.check/record" -type f -exec md5sum {} + | sort | md5sum | cut -d' ' -f1)
echo "  内容哈希 前=$BEFORE"
echo "  内容哈希 后=$AFTER"
[ "$BEFORE" = "$AFTER" ] && pass "判据只读：内容未变（改内容会被抓到，路径清单哈希抓不到）" || bad "记录层内容被改动"

rm -rf "$TMP"
echo
if [ "$fail" -eq 0 ]; then echo "双向测结论: 全通过（0 失败 · 跳过 $skipped 项）"; exit 0; fi
echo "双向测结论: 有 $fail 项失败（跳过 $skipped 项）"; exit 1
