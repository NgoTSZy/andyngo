#!/usr/bin/env node
'use strict';
/* 工作区写权锁 —— 协调「同一天两个会话改同一棵树」。
 *
 * ── 为什么需要（2026-09-16 实测，不是推测）────────────────────────────
 * 现状是**两个写者 + 一条钝规则**：
 *   · 记录层 `DEC-025`：「**本自动化**只做只读回归，**不改任何源文件**」。
 *   · automation 提示词 §三：「**能修的就修**；不能修的必须写清为什么不能修」。
 * **这两句直接矛盾**，而**没有任何判据比对记录层与提示词**（同 ISS-050 家族：
 * 判据的输入没有判据）。今天 automation 按 DEC-025 执行（零源文件改动），
 * 于是「能修的就修」永远不兑现 —— 而交互会话通常一直开着，
 * 按「有并发写者就退让」执行等于**永远退让**。
 *
 * 但 DEC-025 的**顾虑是真的**：并行 Edit 会互相覆盖且两次都报成功（本项目踩过 3 次），
 * 两个写者同时改同一文件会**静默丢更新**。
 * 所以问题不在「该不该让 automation 写」，而在**用一个钝规则代替了一把锁**：
 * 正确做法是**能写、但不同时写**。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node .check/write-lock.js status                 # 谁持有、多久了、它自己声明多久、**是否已过期**
 *   node .check/write-lock.js acquire <who> [ttlMin] # 取锁（**ttlMin 是「我打算持有多久」**）
 *   node .check/write-lock.js release <who>          # 放锁（**只放自己那把**）
 *
 * `<who>` 用能自证归属的短标识，例如 `automation:4ddc05b0` / `session:34b3b3a5`。
 * 成功时 stdout **只打印一行** `LOCK <动作> <who>`，方便调用方解析。
 * `acquire` / `takeover` / `release` 各往 `.check/.write-lock.log` **追加一行**（见下）。
 *
 * ── ★ TTL 由**持有者**声明，不由调用方判定（这条是实测抓出来的）────────
 * 第一版把「过期」按**调用方**给的 TTL 判 —— 于是拿着 30 分钟 TTL 的调用方
 * **永远看不到**别人的锁过期（实测：A 声明 60ms、2 秒后 B 用 30min 判 → 报 busy，永不抢占）。
 * **一个谁都能给自己发长期通行证的判据，等于没有判据**（同 DEC-023 家族）。
 * 现在：TTL 写进锁文件（第 4 字段），**所有人按持有者声明的 TTL 判过期**；
 * 调用方给的 `ttlMin` **只**用于它自己取得锁时的那份声明。
 *
 * ── 退出码（三态分开，同 DEC-013）────────────────────────────────────
 *   0  拿到锁 / 放掉锁 / status 读到结果
 *   2  **拒跑**：锁被别人持有且未过期 —— **没有写入，不是「跑了且不合格」**
 *   4  参数错
 *
 * ── 设计上的三个要点 ─────────────────────────────────────────────────
 *   ① 取锁用 `open(..., 'wx')`（O_EXCL）—— **原子创建**，不是「先查再建」那种两段式
 *      （那正是本文件要修掉的形状，同 DEC-027）。
 *   ② **抢占也原子**：过期锁的抢占先拿一个 `.takeover` 标记（同样 O_EXCL），
 *      再换锁。否则两个进程可能同时判定「过期」并同时重建。
 *   ③ **只放自己那把**：`release` 校验 holder，不是自己的就拒跑（否则会替别人解锁）。
 *
 * ── 已知边界 ─────────────────────────────────────────────────────────
 *   · TTL 过期即视为可用 —— 这是**用时间代替活性检测**。持有者若活着但跑超过自己声明的 TTL，
 *     锁会被别人抢走（故默认 30 分钟；长任务应显式给更长的 TTL）。
 *   · 锁文件在 `.check/.write-lock`，**不进记录层**（运行期状态，不是历史）。
 *   · **锁日志**在 `.check/.write-lock.log`（**append-only**，ISS-118）——
 *     它**是**历史，但同样**不进记录层**：记录层放「判断与账」，它放「运行期事实」。
 *     加它的理由写在 `logEvent` 上方（锁只有一个「现在」、没有「当时」）。
 *     路径可被环境变量 `WRITE_LOCK_LOG` 覆盖 —— **只给自测用**（自测不许污染真日志）。
 *     因此它是**事实，不是保证**：读到的都是真的，但「没读到」不能反推「没发生」。
 * 只读之外只动这两个文件（+ 抢占期短暂的 `.write-lock.takeover`）。 */
const fs = require('fs');
const path = require('path');

const LOCK = path.join(__dirname, '.write-lock');
const MARK = LOCK + '.takeover';
/* 锁日志路径可被 `WRITE_LOCK_LOG` 覆盖 —— 只为一件事：**自测不许污染真日志**。
 * 日志是 append-only 的历史，往里写 `selftest:*` 会让「T 时刻有没有人持锁」
 * 多出**假阳性**（自测取的那把锁不是写者），而假阳性正是这份日志唯一要避免的东西。 */
const LOG = process.env.WRITE_LOCK_LOG || path.join(__dirname, '.write-lock.log');
const DEFAULT_TTL_MIN = 30;

/* 锁文件格式：`<who> <iso> <pid> <ttlMin>`。
 * 兼容旧的三字段形式（没有 ttlMin → 按默认 30 分钟）。
 *
 * 【2026-09-16 · ISS-071】**匹配不上的文件不是锁。**
 * 进程若在 `open('wx')` 与 `write` 之间被杀，会留下一个 **0 字节**的锁文件
 * （本项目实测过两次「命令被执行两次 / 被沙箱掐断」，见 ISS-068）。
 * 旧版把它当成一把**有效锁**：`holder` 为空、`since` 报 `(未知)`、TTL 落到默认 30 分钟 ——
 * 于是 `status` 会打印「有人正持有锁（holder=）」这种**幽灵持有者**，
 * `acquire` 会 rc=2 白等满 30 分钟，而**没有任何人持有任何东西**。
 * 一个读不出持有者的文件**不提供任何互斥信息**，所以它按「不是锁」处理：
 * `ttlMs` 记 0 → 下游一律判「已过期」→ `acquire` 会抢占它、守卫会清掉它。
 * （这不引入竞态：真正活着的持有者在 `open` 与 `write` 之间的窗口是微秒级，
 *   而旧行为是**静默白等 30 分钟**，严格更差。） */
function readLock() {
  let raw;
  try { raw = fs.readFileSync(LOCK, 'utf8').trim(); } catch (e) { return null; }
  const st = fs.statSync(LOCK);
  const m = /^(\S+)\s+(\S+)\s+(\d+)(?:\s+(\S+))?$/.exec(raw);
  if (!m) {
    return { unparseable: true, raw: raw, holder: '', since: '(读不出)', pid: null,
      ttlMs: 0, ageMs: Date.now() - st.mtimeMs };
  }
  const ttlMin = m[4] !== undefined ? Number(m[4]) : DEFAULT_TTL_MIN;
  return {
    unparseable: false,
    holder: m[1],
    since: m[2],
    pid: +m[3],
    ttlMs: Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin * 60000 : DEFAULT_TTL_MIN * 60000,
    ageMs: Date.now() - st.mtimeMs,
  };
}

const fmt = (ms) => Math.round(ms / 1000) + 's';
/* 不足 1 分钟就报秒 —— 报成「0min」会让人以为没声明 TTL（实测踩到过）。 */
const fmtTtl = (ms) => (ms < 60000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 60000) + 'min');

/* ── ★ 锁日志（append-only）—— ISS-118 ─────────────────────────────────
 * **锁保证「取了锁之后不会互相踩」，不保证「你会去取锁」。**
 * 2026-09-16 实测：一次会话释放锁之后接着改了载体与记录层，**全程没重新取锁** ——
 * 而**没有任何判据能事后回答**「某文件在 T 被改、而 T 前后有没有人持锁」：
 * `release` 是 `unlinkSync`，锁只有一个「现在」，**没有「当时」**。
 * 有了 append-only 的持有区间，「改了但没人持锁」才成为一个**可判的形状**
 * （改动时间 vs 持有区间对表）。口径同 `alloc.sh` 的诞生：**把纪律换成机制**。
 *
 * 行格式：`<ISO ts> <ev> <who> [自由文本]`。前三个字段机器可读 —— `who` 不含空格
 * （与锁文件同口径 `\S+`），其后只给人读。事件**只有三个，且都是状态变化**：
 *   acquire / takeover / release
 * `status` **不记**：它是只读命令，一个「读」不该写历史；而且「当时过没过期」
 * 本来就能从持有区间推出来，记下来只会让日志随「谁看了它」而变化。
 *
 * **日志不参与任何判定**：写不进（只读盘 / 盘满 / 权限 / 父目录不存在）就静默跳过 ——
 * 绝不让「日志写不了」变成锁的一个**新的失效模式**（同 DEC-013 三态分开的用意）。 */
function logEvent(ev, who, extra) {
  try {
    fs.appendFileSync(LOG, new Date().toISOString().replace(/\.\d+Z$/, 'Z') + ' ' + ev + ' ' + who +
      (extra ? ' ' + extra : '') + '\n');
  } catch (e) { /* 日志写不进不能挡住锁本身 */ }
}

function busy(cur, extra) {
  console.log('LOCK busy holder=' + (cur ? cur.holder : '(抢占中)') +
    ' age=' + (cur ? fmt(cur.ageMs) : '?') +
    ' 持有者声明=' + (cur ? fmtTtl(cur.ttlMs) : '?') +
    ' since=' + (cur ? cur.since : '?') + (extra ? ' 说明=' + extra : ''));
  return 2;
}

function acquire(who, myTtlMin) {
  const payload = who + ' ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + ' ' + process.pid + ' ' + myTtlMin + '\n';
  try {
    fs.writeSync(fs.openSync(LOCK, 'wx'), payload);
    logEvent('acquire', who, 'ttl=' + myTtlMin + 'min');
    console.log('LOCK acquire ' + who + ' 我声明=' + myTtlMin + 'min');
    return 0;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  /* 过期与否，按**持有者声明的 TTL** 判，不按我的。 */
  const cur = readLock();
  if (cur && cur.ageMs <= cur.ttlMs) return busy(cur);

  /* 过期（或锁刚好被释放）→ 抢占。抢占本身也要原子：只有一个进程能拿到 MARK。 */
  let mfd;
  try { mfd = fs.openSync(MARK, 'wx'); }
  catch (e) { return busy(readLock(), '另一进程正在抢占'); }
  try {
    fs.writeSync(mfd, String(process.pid));
    /* 拿到 MARK 后再复核：这期间锁可能已被持有者正常释放，或被别人抢先重建。 */
    const again = readLock();
    if (again && again.ageMs <= again.ttlMs) return busy(again, '抢占期间被重新获取');
    const stale = again ? again.holder + '（年龄 ' + fmt(again.ageMs) + '，声明 ' + fmtTtl(again.ttlMs) + '）' : '(无)';
    if (again) fs.unlinkSync(LOCK);
    fs.writeSync(fs.openSync(LOCK, 'wx'), payload);
    logEvent('takeover', who, '抢下的过期持有者=' + stale + ' ttl=' + myTtlMin + 'min');
    console.log('LOCK takeover ' + who + ' 抢下的过期持有者=' + stale + ' 我声明=' + myTtlMin + 'min');
    return 0;
  } finally {
    try { fs.unlinkSync(MARK); } catch (e) { /* 清不掉不算失败 */ }
  }
}

function release(who) {
  const cur = readLock();
  if (!cur) { console.log('LOCK free ' + who + ' 说明=本来就没有锁'); return 0; }
  if (cur.holder !== who) return busy(cur, '不是自己那把，拒绝释放（防止替别人解锁）');
  fs.unlinkSync(LOCK);
  logEvent('release', who);
  console.log('LOCK release ' + who);
  return 0;
}

function status() {
  const cur = readLock();
  if (!cur) { console.log('LOCK free'); return 0; }
  /* 【2026-09-16 · ISS-070】「是否已过期」原来**只隐含在 `age` 与「持有者声明」里**，
   * 要读的人自己比大小。但守卫需要的正是这个事实：**活的持有者一个字节都不许碰，
   * 只有过期的才允许清**。让调用方去比大小 = 把同一条规则实现两遍 ——
   * 两遍就会不一致（同 ISS-007「两份实现会互相背书」），而且不一致的方向是**静默**的。
   * 这是**判据输入**、不是展示字段，所以它有专门的自测（`write-lock-test.sh` 第 19/20 项）。 */
  const expired = cur.ageMs > cur.ttlMs;
  console.log('LOCK held holder=' + (cur.unparseable ? '(读不出)' : cur.holder) +
    ' age=' + fmt(cur.ageMs) +
    ' 持有者声明=' + (cur.unparseable ? '(读不出)' : fmtTtl(cur.ttlMs)) +
    ' 已过期=' + (expired ? '是' : '否') +
    (cur.unparseable ? ' 说明=锁文件读不出持有者（' + cur.raw.length + ' 字节）→ 按「不是锁」处理' : '') +
    ' since=' + cur.since + ' pid=' + cur.pid);
  return 0;
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd === 'status') process.exit(status());
if (cmd === 'acquire') {
  if (!argv[1]) { console.error('用法: node .check/write-lock.js acquire <who> [ttlMin]'); process.exit(4); }
  const ttlMin = argv[2] === undefined ? DEFAULT_TTL_MIN : Number(argv[2]);
  if (!Number.isFinite(ttlMin) || ttlMin <= 0) { console.error('ttlMin 必须是正数'); process.exit(4); }
  process.exit(acquire(argv[1], ttlMin));
}
if (cmd === 'release') {
  if (!argv[1]) { console.error('用法: node .check/write-lock.js release <who>'); process.exit(4); }
  process.exit(release(argv[1]));
}
console.error('用法: node .check/write-lock.js status | acquire <who> [ttlMin] | release <who>');
process.exit(4);
