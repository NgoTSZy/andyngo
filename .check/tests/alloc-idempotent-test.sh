#!/usr/bin/env bash
# `alloc.sh` 幂等追加的**双向测**（尺子）—— 2026-09-16 W23 J14 加（ISS-068 / ISS-069 / ISS-079）。
#
# ── 为什么必须有它 ────────────────────────────────────────────────────────────
# 这三条 high 记的是同一件事：**带 `⚠️ Sandbox bypassed` 提示的命令实际被执行了两次**，
# 于是同一条命令追加出**两行逐字相同**的记录（实测 **10 对**，全部落在 2026-09-16 03:38–03:54Z）。
# 处置机制是 `alloc.sh` 的**幂等追加**（写之前先查「这段正文是不是已经在这个文件里」）——
# 但那个机制**此前没有任何常驻测试**：`ISS-079` 说它的双向测是「**即时的（同一条命令内就能验完）**」，
# 也就是**一次性验证**。而本仓库自己的话是「**一条永远拒绝写入的判据和没有判据长得一样**」。
#
# **所以这条尺子测的不是「记录里有没有重复」，而是「防止重复的那个机制还活着吗」。**
# 两者不同：前者是事后清点，后者是**保证下一次不会再发生**。
#
# ── 断言组（每一组都成对，防「门被写成永远返回真/假」）──────────────────────
#   ① 第一次写：+1 行、输出 `ALLOC <号>`
#   ② 同正文再跑：**+0 行**、输出 `SKIP`            ← 幂等（这一条是核心）
#   ③ 换**没写过**的正文：+1 行、号递增              ← 反向守门人
#      没有 ③ 的话，机制若退化成「什么都写不进去」，① ② 会**全部通过**。
#   ④ 号递增（幂等跳过不得消耗号）
#   ⑤ **含换行的正文**（ISS-125，2026-09-17 加）—— 见下。
#
# ── ⑤ 为什么单独立一组 ──────────────────────────────────────────────────────
# `newid.js` 把正文里的换行**折成空格再落盘**，而 `alloc.sh` 的查重拿的是**原始**正文。
# 只要正文里有换行，两边就**永远对不上**。ISS-125 原文把后果写成「重复追加」，
# **实测推翻**：后果是更坏的**静默丢记录** —— `grep -qF` 拿到含换行的模式时按
# 「**多行模式 = OR**」处理，正文里**任意一行**在文件中出现就判「已写过」→ `rc=0` 跳过
# → 一条全新记录**消失、行数不变、没有任何红**。
# 所以 ⑤ 的夹具里，正文**第二行**被故意写成夹具里**已有行的子串**（`marker-a1`）：
#   · 改前（原始正文查重）→ 命中第二行 → `SKIP` → 行数不变 → ⑤a **必须报红**
#   · 改后（折行后查重）  → 整行不在文件里 → `ALLOC` → 行数 +1 → ⑤a 过
# **这就是反向断言**：把被修的东西剥掉，必须复现旧缺陷。只测「改后能 SKIP」是不够的 ——
# 那样一个「什么都查得到」的坏口径也会全绿（同 ③ 的用意）。
#
# 用法：bash .check/tests/alloc-idempotent-test.sh
# 退出码：0 = 全过 · 1 = 有断言不符 · 2 = 拒跑（夹具建不起来）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

if [[ ! -f "$ROOT/.check/record/alloc.sh" || ! -f "$ROOT/.check/record/newid.js" ]]; then
  echo "SKIP 无 .check/record/alloc.sh 或 newid.js"; exit 2
fi

# POSIX 路径 → Windows 形式（**只给原生 node 用**）。同 `andyngo-record.sh` / `andyngo-audit.sh` 的实现。
# **不加这一步，夹具路径会被解析成 `C:\tmp\...`** —— 本项目踩过多次（ISS-003 / ISS-110 / DEC-038）。
win() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT
FIX="$D/issues.md"
printf '%s\n' '# 夹具（不是真记录）' '' '---' > "$FIX"
B1="$D/body1.txt"; B2="$D/body2.txt"; B3="$D/body3.txt"
printf '%s\n' 'open 2026-09-16T00:00Z 2026-09-16T00:00Z low 【夹具正文一】marker-a1' > "$B1"
printf '%s\n' 'open 2026-09-16T00:00Z 2026-09-16T00:00Z low 【夹具正文二】marker-b2' > "$B2"
# ⑤ 的夹具：**第二行故意是已有行的子串**（`marker-a1` 在 ISS-001 行里）。
# 这正是 ISS-125 复现缺陷时用的输入形状 —— 不是随手编的，是**实测现场抄下来的**。
printf '%s\n' 'open 2026-09-16T00:00Z 2026-09-16T00:00Z medium 【夹具正文三】marker-c3' 'marker-a1' > "$B3"

lines() { grep -c '^ISS-' "$FIX" || true; }

echo "=== alloc.sh 幂等追加 · 双向测（ISS-068 / ISS-069 / ISS-079）==="
echo "夹具: $FIX"
echo
fail=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }

# ① 第一次写
out1=$(bash .check/record/alloc.sh "$(win "$FIX")" ISS - "@$(win "$B1")" 2>&1); rc1=$?
n1=$(lines)
echo "--- ① 第一次写（期望：ALLOC · rc=0 · +1 行）---"
echo "$out1" | sed 's/^/      /'
if [[ $rc1 -eq 0 && "$out1" == ALLOC\ * && "$n1" == "1" ]]; then ok "① 第一次写：$out1 · 行数 $n1"
else bad "① 第一次写：期望 ALLOC + rc=0 + 1 行，实得 rc=$rc1 · 行数 $n1 · 输出: $out1"; fi

# ② 同正文再跑（**核心**）
out2=$(bash .check/record/alloc.sh "$(win "$FIX")" ISS - "@$(win "$B1")" 2>&1); rc2=$?
n2=$(lines)
echo "--- ② 同正文再跑（期望：SKIP · rc=0 · **+0 行**）---"
echo "$out2" | sed 's/^/      /'
if [[ $rc2 -eq 0 && "$out2" == *SKIP* && "$n2" == "1" ]]; then ok "② 幂等：SKIP · 行数仍为 $n2（**没有多出第二行**）"
else bad "② 幂等失效：期望 SKIP + rc=0 + 行数仍 1，实得 rc=$rc2 · 行数 $n2 · 输出: $out2"; fi

# ③ 反向守门人：换没写过的正文 —— 必须**能**写进去
out3=$(bash .check/record/alloc.sh "$(win "$FIX")" ISS - "@$(win "$B2")" 2>&1); rc3=$?
n3=$(lines)
echo "--- ③ 反向：换**没写过**的正文（期望：ALLOC · rc=0 · 2 行）---"
echo "$out3" | sed 's/^/      /'
if [[ $rc3 -eq 0 && "$out3" == ALLOC\ * && "$n3" == "2" ]]; then ok "③ 反向：$out3 · 行数 $n3 —— **门是活的**（不是「什么都写不进去」）"
else bad "③ 反向失败：期望 ALLOC + rc=0 + 2 行，实得 rc=$rc3 · 行数 $n3 · 输出: $out3"; fi

# ④ 号必须递增（幂等跳过**不得**消耗号）
if [[ "$out1" == *ISS-001 && "$out3" == *ISS-002 ]]; then ok "④ 号递增：ISS-001 → ISS-002（跳过的第二次**没有**消耗号）"
else bad "④ 号不递增：实得 ①=$out1 · ③=$out3"; fi

# ⑤ 含换行的正文（ISS-125）—— 改前必红，改后必绿
out5=$(bash .check/record/alloc.sh "$(win "$FIX")" ISS - "@$(win "$B3")" 2>&1); rc5=$?
n5=$(lines)
echo "--- ⑤ 含**换行**的正文（期望：ALLOC · rc=0 · 3 行）---"
echo "$out5" | sed 's/^/      /'
if [[ $rc5 -eq 0 && "$out5" == ALLOC\ * && "$n5" == "3" ]]; then ok "⑤a 换行正文**写得进去**：$out5 · 行数 $n5（改前这里会被第二行误判成「已写过」→ 静默丢记录）"
else bad "⑤a 换行正文被静默丢弃：期望 ALLOC + rc=0 + 3 行，实得 rc=$rc5 · 行数 $n5 · 输出: $out5"; fi

out6=$(bash .check/record/alloc.sh "$(win "$FIX")" ISS - "@$(win "$B3")" 2>&1); rc6=$?
n6=$(lines)
echo "--- ⑤b 同正文再跑（期望：SKIP · rc=0 · **仍 3 行**）---"
echo "$out6" | sed 's/^/      /'
if [[ $rc6 -eq 0 && "$out6" == *SKIP* && "$n6" == "3" ]]; then ok "⑤b 换行正文的幂等：SKIP · 行数仍为 $n6"
else bad "⑤b 换行正文幂等失效：期望 SKIP + rc=0 + 3 行，实得 rc=$rc6 · 行数 $n6 · 输出: $out6"; fi

# ⑤c 折行**真的生效**：落盘的那一行必须**同时**含两个 marker（否则换行被原样写进了记录层）
c5=$(grep -c '^ISS-003 .*marker-c3.*marker-a1' "$FIX" || true)
echo "--- ⑤c 落盘形态（期望：ISS-003 一行内含两个 marker）---"
grep '^ISS-003 ' "$FIX" | sed 's/^/      /'
if [[ "$c5" == "1" ]]; then ok "⑤c 折行生效：两个 marker 落在**同一行**（换行没有渗进记录层）"
else bad "⑤c 折行未生效：期望 1 行同时含 marker-c3 与 marker-a1，实得 $c5"; fi

echo
# ── 附（**只报告，不判定**）────────────────────────────────────────────────
# 「记录里现在有几对正文逐字相同」—— 把一次性的人工清点变成**活的数字**，
# 否则那个数只存在于 `ISS-079` 的散文里，**改一次就腐烂**（同 `record-shape.js --holes` 的用意）。
# **为什么不把它升成判据**：实测 10 对**全是真阳性、假红 0**（全部落在同一个 16 分钟窗口、
# 全部是沙箱重跑的产物），但它们在**只能追加**的记录层里**改不掉** ——
# 升成判据就要在第一天加 10 条豁免，而它防的那件事**已经被 `alloc.sh` 的幂等挡在写入之前**。
# 本尺子上面三组断言的，正是那个机制**还活着**。所以这里只报数，不判红。
node -e '
const fs=require("fs"),path=require("path");
const R=".check/record";
const files=[["issues.md",/^ISS-\d+ /],["decisions.md",/^DEC-\d+ /],["changes.md",/^CHG-\d+ /]];
try{for(const n of fs.readdirSync(path.join(R,"eventlog"))) if(n.endsWith(".txt")) files.push(["eventlog/"+n,/^EVT \d+ /]);}catch(e){}
let pairs=0, ids=[];
for(const [f,re] of files){
  let s=""; try{s=fs.readFileSync(path.join(R,f),"utf8");}catch(e){continue;}
  const m=new Map();
  for(const ln of s.split("\n")){
    if(!re.test(ln)) continue;
    const id=ln.split(" ")[0], body=ln.slice(id.length);
    if(!m.has(body)) m.set(body,[]);
    m.get(body).push(id);
  }
  for(const [,v] of [...m.entries()].filter(([,v])=>v.length>1)){ pairs++; ids.push(v.join("≡")); }
}
console.log("附（只报告，不判定）: 现记录语料里**正文逐字相同**的记录对 = "+pairs+" 对"+(pairs?" —— "+ids.join(" · "):""));
' 2>/dev/null || echo "附（只报告，不判定）: 清点失败（不影响上面的断言）"

echo
echo "结论: $((7-fail))/7 条符合期望"
exit $((fail ? 1 : 0))
