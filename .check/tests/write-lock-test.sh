#!/usr/bin/env bash
# write-lock.js 的自测 —— 把 12 个出口逐个钉住。
#
# 为什么必须有：锁的失效方向是**静默**的 —— 一把坏锁不会报错，
# 只会让两个写者同时进临界区，然后**丢掉其中一份更新**（本项目踩过 3 次并行 Edit）。
# 而第一版锁**第一次跑就有一个真缺陷**（过期按调用方的 TTL 判 → 长 TTL 的调用方
# 永远看不到别人的锁过期），所以「跑过一遍」不是可选项。
#
# 只动 `.check/.write-lock` · `.check/.write-lock.takeover`，以及**日志 fixture**
# `.check/record/tmp/fixture/wlt-log.txt`（**所有**取锁调用都把 `WRITE_LOCK_LOG` 指到它 ——
# 自测**不许**往真日志 `.check/.write-lock.log` 里写，ISS-118），跑完不残留。
# 退出码：0 全通过 / 1 有失败 / 2 **拒跑**（有人正持锁，见下）。
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
L="node .check/write-lock.js"
# ★ 2026-09-16（ISS-118）：**所有**取锁调用都把锁日志指到 fixture —— 用 `export`，
# 于是连子进程一起覆盖。理由：真日志是 append-only 的历史，自测往里写 `selftest:*`
# 会让「T 时刻有没有人持锁」多出**假阳性**（自测取的那把锁不是写者）。
# ★ 这里**不能**写成 `env WRITE_LOCK_LOG=… node …`：本机 `env` 被
# `~/.local/bin/env`（一个只改 PATH、**不执行命令**的 shell 存根）遮蔽，
# 那种写法会**静默变成空操作且 rc=0** —— 实测后果是锁从没被创建、
# 第 17 项的内层守卫看不见锁 → **递归**（ISS-119）。用 export 就没有这个中间人。
WLLOG_FIX=".check/record/tmp/fixture/wlt-log.txt"
export WRITE_LOCK_LOG="$WLLOG_FIX"
fails=0
items=0   # ★ 2026-09-17（ISS-140）：**通过项数**。存在的唯一理由 = 让末行**算出**总项数，
          #   而不是写死一个数（原先那里写死 `28` —— 「写死的值会腐烂，指针不会」）。
ok()   { echo "PASS  $1"; items=$((items + 1)); }
bad()  { echo "FAIL  $1  （期望 rc=$2 实得 rc=$3）"; fails=$((fails + 1)); }
# 量退出码**不经管道**（管道拿到的是 tail 的状态，恒 0 —— 本项目踩过）
chk() { # chk <期望rc> <描述> <命令…>
  local want="$1" desc="$2"; shift 2
  "$@" >/dev/null 2>&1; local got=$?
  [ "$got" = "$want" ] && ok "$desc" || bad "$desc" "$want" "$got"
}
out() { "$@" 2>&1; }

# ---- 起手：**活的持有者一个字节都不许碰；只有「已过期」才允许清**（ISS-060 → ISS-070）----
# 规则正文与全部理由已抽到 `.check/tests/write-lock-guard.sh`（**唯一实现**），
# 这里只调用它 —— 抽出去的理由是**递归**：守卫若住在本文件里，
# 「测守卫」就只能「再跑一次本文件」，而那正是第一版翻车的形状（实测 112 个嵌套进程）。
# 这里保留三行结论，细节看那个文件：
#   · 原写法 `rm -f` 与生产**共用同一把锁文件** → 跑一次自测 = 静默销毁别人正持有的锁（ISS-060）。
#   · 第二版按**名字**放行（`selftest:` 前缀 = 自己上次的残留）→ ① 自指守门人无限递归
#     ② 并发下删掉别人的活锁（ISS-070）。
#   · 现在：**「已过期」是允许清的唯一理由，名字不参与判定**；读不出状态一律拒跑。
bash .check/tests/write-lock-guard.sh; GUARD_RC=$?
if [ "$GUARD_RC" = "2" ]; then
  echo "----"
  echo "write-lock 自测：拒跑（rc=2，**未动任何文件**）"
  exit 2
fi
if [ "$GUARD_RC" != "0" ]; then
  echo "FAIL  守卫自身非 0/2 退出（rc=$GUARD_RC）—— 守卫坏了，不能当成「通过」"
  exit 1
fi

# fixture 目录必须先建：`WRITE_LOCK_LOG` 的**父目录不存在**时 `appendFileSync` 会失败 ——
# 那正是第 27 项要**故意**造出来的情形，所以这里必须先让它存在。
mkdir -p "$(dirname "$WLLOG_FIX")"; rm -f "$WLLOG_FIX"

chk 0 "1 status 空闲 → 0"                     $L status
chk 0 "2 acquire A → 0"                       $L acquire selftest:testA 5
chk 2 "3 acquire B 被占 → 2（拒跑，不是失败）"  $L acquire selftest:testB 5
chk 2 "4 release B 不是自己那把 → 2"           $L release selftest:testB
chk 0 "5 status 读到持有者 → 0"                $L status
chk 0 "6 release A → 0"                       $L release selftest:testA
chk 0 "7 status 又空闲 → 0"                    $L status
chk 0 "8 acquire A 声明 60ms → 0"              $L acquire selftest:staleA 0.001
sleep 2
chk 0 "9 acquire B 抢过期锁 → 0（takeover）"    $L acquire selftest:staleB 5
chk 0 "10 release B → 0"                      $L release selftest:staleB
chk 4 "11 缺参数 → 4（参数错）"                 $L acquire
chk 4 "12 非法 ttl → 4"                        $L acquire who 0

# 语义断言（不只是退出码）：
if out $L acquire selftest:semantic 5 | grep -q "我声明=5min"; then ok "13 取得锁时打印自己的声明"; else bad "13 取得锁时打印自己的声明" "含 我声明=5min" "(不含)"; fi
if out $L status | grep -q "持有者声明=5min"; then ok "14 status 显示持有者声明的 TTL"; else bad "14 status 显示持有者声明的 TTL" "含 持有者声明=5min" "(不含)"; fi
out $L release selftest:semantic >/dev/null
if out $L status | grep -q "^LOCK free"; then ok "15 释放后回到 free"; else bad "15 释放后回到 free" "LOCK free" "(不是)"; fi

# 残留检查：跑完不许留锁文件（否则下一轮开工会被一把僵尸锁挡住）
if [ -e .check/.write-lock ] || [ -e .check/.write-lock.takeover ]; then
  echo "FAIL  16 跑完不应残留锁文件"; fails=$((fails + 1))
else ok "16 跑完无残留"; fi

# ---- 17 守门人：**持锁时本测试必须拒跑，且一个字节都不许动**（ISS-060 的回归）------
# 这一项是**自指的**：它取一把锁，然后**再跑一次本脚本**，断言那次 rc=2 且锁文件逐字节不变。
# 没有它的话，ISS-060 修完之后没人能保证它不会退回去 —— 而它的失效方向是**静默**的
# （跑一次就把别人的锁删了，输出一切正常）。
# 【ISS-070 追加的边界】**「递归只有一层」是必须被钉住的性质，不是自明的。**
# 第一版靠「内层撞上守卫」实现它，而守卫当时按**名字**放行（`selftest:` 前缀）——
# 守卫自己那把恰好也叫 `selftest:guard`，于是内层**不撞守卫**、直接再跑一遍整份测试，
# 跑到这里又递归一次。实测 **112 个嵌套进程**。
# 现在守卫按**过期与否**判定：guard 锁声明 5 分钟、内层毫秒级就起来 → 必然读到「未过期」→ 拒跑。
# 于是「一层」由**规则**保证，而不是由「名字刚好不撞」保证。
# 第 19 项另有一条**直接**钉住这个性质的断言（看内层的输出里有没有第 1 项），不依赖上面的推理。
out $L acquire selftest:guard 5 >/dev/null
BEFORE=$(cat .check/.write-lock 2>/dev/null)
bash .check/tests/write-lock-test.sh >/tmp/wlt-inner.out 2>&1; INNER_RC=$?
AFTER=$(cat .check/.write-lock 2>/dev/null)
if [ "$INNER_RC" = "2" ] && [ -n "$AFTER" ] && [ "$BEFORE" = "$AFTER" ]; then
  ok "17 持锁时自测拒跑（rc=2）且**未删锁**（逐字节不变）"
else
  bad "17 持锁时自测拒跑且未删锁" "rc=2 且锁不变" "rc=$INNER_RC 前[$BEFORE] 后[$AFTER]"
fi
out $L release selftest:guard >/dev/null
if [ -e .check/.write-lock ]; then
  echo "FAIL  18 守门人用完应把 guard 锁放掉"; fails=$((fails + 1))
else ok "18 守门人用完无残留"; fi

# ---- 19 **递归只有一层** —— 直接钉住，不靠推理（ISS-070）------------------------
# 第 17 项证明「内层拒跑了」，但那句话**不足以**排除递归：
# 第一版的失效形状正是「内层不拒跑、而是再跑一遍整份测试」。所以这里**直接看内层的输出**：
# 它必须出现守卫的拒跑字样，且**不许出现第 1 项**（出现第 1 项 = 它真的开始跑了）。
# 这一项**必须**留着：它是唯一能抓住「守卫放行了本该拒跑的那把锁」的断言。
INNER_OUT=$(cat /tmp/wlt-inner.out 2>/dev/null)
if echo "$INNER_OUT" | grep -q '拒跑' && ! echo "$INNER_OUT" | grep -q 'PASS  1 status'; then
  ok "19 内层只拒跑、没开始跑（无递归）"
else
  bad "19 内层只拒跑、没开始跑（无递归）" "含『拒跑』且不含『PASS  1 status』" \
      "内层输出 $(echo "$INNER_OUT" | wc -l) 行；含拒跑=$(echo "$INNER_OUT" | grep -c '拒跑') 含PASS1=$(echo "$INNER_OUT" | grep -c 'PASS  1 status')"
fi

# ---- 20/21 `status` 必须**直接说出**是否已过期（守卫的判定输入，ISS-070）------------
# 这是**判据输入**，不是展示字段：守卫全靠它决定「清」还是「拒跑」。
# 它一旦报错方向，守卫的失效方向是**静默的**（把活锁当过期锁清掉 —— ISS-060 原形）。
out $L acquire selftest:ttl 5 >/dev/null
if out $L status | grep -q '已过期=否'; then ok "20 活锁 → status 报『已过期=否』"; else bad "20 活锁 → status 报『已过期=否』" "含 已过期=否" "$(out $L status)"; fi
out $L release selftest:ttl >/dev/null
out $L acquire selftest:ttl 0.001 >/dev/null
sleep 2
if out $L status | grep -q '已过期=是'; then ok "21 过期锁 → status 报『已过期=是』"; else bad "21 过期锁 → status 报『已过期=是』" "含 已过期=是" "$(out $L status)"; fi

# ---- 22/23 **守卫的两个方向都要钉住**（第 17 项只钉住了「未过期 → 拒跑」）------------
# 缺了这两项的话，「守卫改成一律拒跑」也会全绿 —— 而那正是本项目最怕的形状：
# **判据只钉住了一个方向**。方向二、三都**直接调守卫脚本**（不跑整份测试），
# 所以结构上不可能递归（这正是把守卫抽成独立文件的原因）。
# 方向二：**已过期 → 清掉并继续**（上面第 21 项留下的 `selftest:ttl` 就是现成的一把）。
if [ -e .check/.write-lock ]; then
  bash .check/tests/write-lock-guard.sh >/tmp/wlt-guard1.out 2>&1; G1=$?
  if [ "$G1" = "0" ] && [ ! -e .check/.write-lock ] && grep -q '已过期' /tmp/wlt-guard1.out; then
    ok "22 过期锁 → 守卫自己清掉并放行（rc=0，锁已消失）"
  else
    bad "22 过期锁 → 守卫自己清掉并放行（rc=0，锁已消失）" "rc=0 且锁消失且输出含『已过期』" \
        "rc=$G1 锁还在=$([ -e .check/.write-lock ] && echo 是 || echo 否) 输出[$(head -1 /tmp/wlt-guard1.out)]"
  fi
else
  echo "FAIL  22 前置失败：第 21 项没留下过期锁"; fails=$((fails + 1))
fi
# 方向三：**存在但读不出持有者（0 字节）→ 也清掉**（ISS-071；残留形状见 ISS-063/068：
# 进程在 `open('wx')` 与 `write` 之间被杀，会留下一个 0 字节的锁文件）。
# 实测改前的行为：`status` 报 `holder=`（**幽灵持有者**）`已过期=否`、`acquire` rc=2 ——
# **没有任何人持有任何东西，却要白等满 30 分钟**，而且报出来的人是不存在的。
printf '' > .check/.write-lock
bash .check/tests/write-lock-guard.sh >/tmp/wlt-guard2.out 2>&1; G2=$?
if [ "$G2" = "0" ] && [ ! -e .check/.write-lock ]; then
  ok "23 0 字节锁（读不出持有者）→ 守卫清掉并放行（rc=0）"
else
  bad "23 0 字节锁（读不出持有者）→ 守卫清掉并放行（rc=0）" "rc=0 且锁消失" \
      "rc=$G2 锁还在=$([ -e .check/.write-lock ] && echo 是 || echo 否) 输出[$(head -1 /tmp/wlt-guard2.out)]"
fi

# ---- 24–28 **锁日志**（ISS-118）----------------------------------------------------
# 为什么测：日志的用途是让「改了但没人持锁」事后可判。它一旦**静默不写**，
# 缺口就悄悄回来了 —— 而锁本身一切正常（失效方向是**静默**的，同本文件开头那句）。
# 全部走 `$L`（日志指到 fixture）→ **自测不写真日志**；只有第 27 项用裸命令。
$L acquire selftest:log 5 >/dev/null 2>&1
if grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z acquire selftest:log ' "$WLLOG_FIX"; then
  ok "24 acquire 往日志追加一行（ts 为秒级 ISO-Z · ev · who）"
else
  bad "24 acquire 往日志追加一行" "匹配 ^<ISO>Z acquire selftest:log " "实际[$(head -1 "$WLLOG_FIX" 2>/dev/null)]"
fi
N1=$(grep -c '' "$WLLOG_FIX" 2>/dev/null)
FIRST=$(head -1 "$WLLOG_FIX" 2>/dev/null)
$L release selftest:log >/dev/null 2>&1
if [ "$(grep -c ' release selftest:log$' "$WLLOG_FIX")" = "1" ] &&
   [ "$(grep -c '' "$WLLOG_FIX")" = "$((N1 + 1))" ] &&
   [ "$(head -1 "$WLLOG_FIX")" = "$FIRST" ]; then
  ok "25 release 也追加一行，且**只追加**（旧行逐字不动）"
else
  bad "25 release 追加一行且只追加" "$((N1 + 1)) 行且首行不变" \
      "$(grep -c '' "$WLLOG_FIX") 行 · 首行未变=$([ "$(head -1 "$WLLOG_FIX")" = "$FIRST" ] && echo 是 || echo 否)"
fi
$L acquire selftest:logstale 0.001 >/dev/null 2>&1
sleep 2
$L acquire selftest:logtake 5 >/dev/null 2>&1
$L release selftest:logtake >/dev/null 2>&1
if grep -q ' takeover selftest:logtake ' "$WLLOG_FIX"; then
  ok "26 takeover 也记一行（含被抢下的持有者）"
else
  bad "26 takeover 也记一行" "含 ' takeover selftest:logtake '" "日志尾[$(tail -1 "$WLLOG_FIX" 2>/dev/null)]"
fi
# 27 日志写不进去**不能挡住锁**（写不进的形状：父目录不存在 → ENOENT）
BADLOG=".check/record/tmp/fixture/no-such-dir/x.log"
rm -rf "$(dirname "$BADLOG")"
WRITE_LOCK_LOG="$BADLOG" $L acquire selftest:badlog 5 >/dev/null 2>&1; RC1=$?
WRITE_LOCK_LOG="$BADLOG" $L release selftest:badlog >/dev/null 2>&1; RC2=$?
if [ "$RC1" = "0" ] && [ "$RC2" = "0" ] && [ ! -e .check/.write-lock ]; then
  ok "27 日志写不进去（父目录不存在）→ 锁照常 rc=0，无残留"
else
  bad "27 日志写不进去不挡锁" "acquire rc=0 · release rc=0 · 无锁残留" \
      "rc=$RC1/$RC2 · 锁还在=$([ -e .check/.write-lock ] && echo 是 || echo 否)"
fi
# 28 自测**不许**碰真日志（`WRITE_LOCK_LOG` 存在的唯一理由）+ fixture 要清掉
rm -f "$WLLOG_FIX"
REALLOG=".check/.write-lock.log"
if [ ! -e "$WLLOG_FIX" ] && { [ ! -e "$REALLOG" ] || ! grep -q 'selftest:' "$REALLOG"; }; then
  ok "28 fixture 已清，且**真日志没被自测污染**"
else
  bad "28 fixture 已清且真日志未被污染" "fixture 不存在 · 真日志 0 行含 selftest:" \
      "fixture 还在=$([ -e "$WLLOG_FIX" ] && echo 是 || echo 否) · 真日志 selftest 行数=$(grep -c 'selftest:' "$REALLOG" 2>/dev/null || echo 0)"
fi

echo "----"
total=$((items + fails))   # ★ 总项数 = 通过 + 失败（**算出来的**，不写死 —— ISS-140）
if [ "$fails" -eq 0 ]; then echo "write-lock 自测：$total 项全通过"; exit 0; fi
echo "write-lock 自测：$fails 项失败"; exit 1
