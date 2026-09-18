'use strict';
/* host-log.js —— 读**宿主自己的日志**，回答三个问题：
 *   ① 宿主 spawn 过哪些 hook？（`acceptance.js` 第 [99] 项）
 *   ② 那条 automation 触发过没有？（第 [98] 项）
 *   ③ 触发之后，**它跑的命令有没有真的产出**？（第 [98] 项，靠「配对」）
 *
 * 为什么单独一个文件：三个检查 + 自测都要用，**复制两份就会静默分叉**
 * （与 `.check/fileset.js`、`.check/hook-trace.js` 同一条理由）。
 *
 * 【③ 为什么要配对，而不是只读运行记录】
 * 「触发过」和「有产出」是两件事。宿主的 `automation_runs` 表只有
 * `status / runs_json / result_success` —— **不存产出文本**（产出是对话消息，在另一张表）。
 * 所以宿主侧根本给不出「产出」的判据。而 automation 的产出是一条它自己写的消息，
 * 「它说它跑了」不构成证据 —— 与 `src=host` 同一个形状。
 *
 * 于是第三条判据由**程序**生产，不由**叙述者**生产：`acceptance.js` 每次跑完
 * 自己往 `.check/acceptance-ledger.txt` 追加一行。automation 只负责执行
 * `node .check/acceptance.js`，那一行是命令真的跑到收尾才会有的**副作用**。
 * 不写 = 没有那一行 = 跑了但没产出。
 *
 * **配对会滞后一次运行**（写下来，不藏）：automation 在 09:00 跑 acceptance，
 * 而它这次的运行记录要等它跑完（约 4 分钟后）才落盘。所以 [98] 判的是
 * **上一次**运行有没有产出。这不是缺陷 —— 一次正在进行的运行本来就不该被判。
 *
 * **残留风险（同 hook 指纹那条，说清楚边界）**：账本把「静默无产出」变成了
 * 「必须主动写一行假账」。它不是不可伪造，是把伪造成本从 0 提到了「必须动手」——
 * 而动手会在对话记录里留下痕迹。
 *
 * **为什么不能用被测对象自己的记录**：
 * 2026-09-15 我为了测 hook 的来源标记，**亲手伪造**了 4 行 `src=host`。
 * 一个我自己就能生产出来的证据，不是证据。同理，「automation 会跑」也不能靠
 * automation 的提示词或它自己写的文件 —— 要靠宿主写的 `[AutomationRecords]` 行。
 *
 * **一次扫描，三个答案。** 宿主日志是几十 MB，扫两遍等于把验收时间翻倍。
 *
 * 扫三处：
 *   · `logs/<最新日期>/*.log` —— 会话日志，`[HookExecutor] spawn` 在这里
 *   · `logs/<最新日期>/sdk/conversations/*.log` —— **automation 的会话在这里**
 *   · `logs/*.log`（根目录）—— `daemon.log` / `daemon.old.log`，`[AutomationRecords]` 在这里
 *
 * 【为什么必须加 `sdk/conversations/`（2026-09-15 改）】
 * 实测：automation 跑起来的那个会话，日志在 `logs/<日期>/sdk/conversations/<sessionId>.log`
 * —— **不在顶层**。而 `[HookExecutor] spawn` 在那个文件里也出现了（探针会话里有 2 次）。
 * 漏掉这一支的后果不是「少看一点」，而是：**[99] 说的是一句否定（「宿主从未 spawn 过它」），
 * 而否定的强度不能超过证据的覆盖范围。** 漏掉一个还会出现 spawn 的目录，
 * 那句否定就是**过度断言** —— 与撞预算时那次同一个形状。
 * 同理 [98] 的因果链也在这个目录里（见下面 `findSessionAcceptanceRuns`）。
 *
 * 【为什么连 `daemon.old.log` 也扫（原来是跳过的，2026-09-15 改）】
 * 实测：`daemon.log` 是**按大小滚动**的 —— `daemon.old.log` 恰好 10,485,749 字节
 * （10 MiB），不是按天。**留存期只有「当前 + 上一份」两个 10 MiB。**
 * 而 [98] 要配的是「最近一次运行」，跳过旧文件等于把留存期砍掉一半，
 * 会让 [98] 在日志滚动后**永远卡在第三态**。留存期才是这里的约束，陈旧命中不是 ——
 * 陈旧由下面的新鲜度闸门处理，不靠丢文件处理。
 */
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(__dirname, '..');
/* 预算 160 MiB 是**实测不够**的（2026-09-15 改）：当天 `logs/<日期>/` 13 个文件
 * 合计 136 MiB，加根目录两个 daemon 约 43 MiB = 179 MiB。撞预算就会在中途 break，
 * 而 break 在哪取决于 `readdirSync` 的顺序 —— **结果随文件系统顺序变**，
 * 那是随机红绿，不是检查，所以抬到 512 MiB。
 * **512 MiB 后来又不够了**（2026-09-15）：`sdk/conversations/` 里单个会话日志
 * **577 MB**，加顶层 226 MB 直接撑爆 —— 结果只读完顶层就 break，`autoRuns=0`，
 * 而 [98] 会把它读成「未到点」。**这是「没扫完」伪装成「没有」，最坏的一种。**
 * 现在改成**分块读**（见 `eachLine`），内存是 O(块) 不是 O(文件)，所以预算可以放宽；
 * 预算仍然要留 —— 它是防止某个日志病态增长把验收拖死的安全阀。
 * 撞预算时的行为见 `complete` 标志 —— **扫不完就不许下否定结论**。
 *
 * 【2026-09-15 再改：2 GiB → 4 GiB】实测 `logs/` 共 **3.2 G**（今天目录 2.1 G，26 个文件），
 * 而预算只有 2 GiB —— 于是**每轮都报「未扫完」**。这不只是显示问题：
 * `complete=false` 会让 [98] 那句否定（「没有运行记录」）**永远没有资格下**，
 * **判据长期停在 UNVERIFIED，和没有判据是一回事**。
 * 4 GiB 覆盖当前全部日志；扫描本身不是瓶颈 —— 实测 100 MB / 333 ms，4 GiB 约 13 秒，
 * 而验收全程 4–5 分钟（主要是四套变异电池）。
 * **覆盖率报告仍然保留**：日志会继续增长，总有一天又超 —— 那时要有量纲地报出来，
 * 而不是丢一个「未扫完」。 */
const BUDGET = 4 * 1024 * 1024 * 1024;
/* 曾经这里是 SKIP = ['daemon.old.log']。删掉的理由见文件头。 */

/* 实测的一整行长这样（2026-09-15）：
 *   [AutomationRecords] terminal run record written automationId=140c89de-…,
 *   runId=140c89de-…:1789460294624, status=ACCEPTED, sessionId=70cb40a8-…,
 *   finishedAt=1789460589722, interrupted=false
 * 所以 `sessionId` 是拿得到的 —— 它是 [98] 因果链的钥匙，必须一起抓下来。 */
/* 后两组做成**可选**：万一哪天宿主少写 `sessionId`，不能整条记录都丢掉 ——
 * 丢了就变成「没有运行记录」，而那会被读成「未到点」。**缺字段降级，不静默丢弃。** */
const RE_AUTO = /\[AutomationRecords\] terminal run record written automationId=([0-9a-fA-F-]+)[^\n]*?status=([A-Za-z_]+)(?:[^\n]*?sessionId=([0-9a-fA-F-]+))?(?:[^\n]*?finishedAt=(\d+))?/g;
/* 【2026-09-16 · ISS-046】**起点记录** —— 上面那条只认**终态**，于是「本轮正在跑」
 * 在 `[98]` 里长得和「从未触发」一模一样（`autoRuns=0` → 明细写「未到点」）。
 * 实测的起点行（2026-09-16 01:05:34.340Z）：
 *   [AutomationRecords] startRunRecord written automationId=4ddc05b0-…,
 *   runId=4ddc05b0-…:1789520734329, startedAt=1789520734332, cwd=C:\Users\<user>\.workbuddy-ai
 * **不并入 `autoRuns`**：判定逻辑（`pairRunWithLedger`）只该看终态 ——
 * 把起点混进去会让「跑了一半」被当成「跑完了」。它只做一件事：**让「在跑」可见**。
 * 一条永远为 0 的计数是噪声；一条**能与终态数对比**的计数才是证据（start > terminal = 在跑）。 */
const RE_AUTO_START = /\[AutomationRecords\] startRunRecord written automationId=([0-9a-fA-F-]+)[^\n]*?startedAt=(\d+)/g;
/* 两种形状都得认 —— 实测两种都存在：
 *   daemon.log 里是 `"timestamp":"2026-09-15T06:34:43.244Z"`（**带引号的 ISO 串**）
 *   会话日志里是 `"timestamp":1789460429022`（**不带引号的毫秒数**）
 * 只认一种，就会在另一个地方静默返回 null，而 null 会被当成「配不上」。 */
const RE_TS = /"timestamp":\s*(?:"([^"]+)"|(\d{1,20}))/;

/* automation 那一轮里**真的执行过的 Bash 命令**（从它自己的会话日志里读）。
 * 实测的一行（会话日志是 JSON 行）：
 *   …"status":"completed","toolName":"Bash","title":"Bash","kind":"other",
 *   "rawInput":{"command":"cd /c/Users/<user>/.workbuddy-ai && node .check/acceptance.js;
 *    echo \"EXIT_CODE=$?\"","description":"…"},"timestamp":1789460429022…
 * 只认 `toolName":"Bash"` 且命令里含 `acceptance.js` 的。
 *
 * 【2026-09-16 · 停用（ISS-051）】**这个形状只出现在「我自己」的会话日志里。**
 * automation 会话的同一文件里 `"toolName"` 出现 **0 次**（它是 ACP 协议事件流），
 * 所以拿它当唯一形状 = 对 automation **永远返回空数组** = 结构性假红。
 * 留着不删：它是「**形状认错 → 假阴性**」这次事故的物证。
 * 现在读工作区级日志，用 `[BashTool] execute start | command="…"`（见
 * `findSessionAcceptanceRuns` 上方）。 */
const RE_SESS_CMD = /"toolName":"Bash"[^\n]*?"rawInput":\{"command":"((?:[^"\\]|\\.)*)"/g;

/* 【判据的原料里不许含被检验者的输出 —— 2026-09-15 实测踩到】
 * 原来 [99] 的判据是「**同一行**里既有 `[HookExecutor] spawn` 又有 `.check/`」。
 * 加扫 `sdk/conversations/` 之后它立刻报出 `mine=2`，看起来像「hook 终于被调了」。
 * 查下去：**两行都是假阳性** —— 那是探针会话自己的一行，里面
 *   · `.check/` 来自**提示词**（`node .check/acceptance.js`）
 *   · `[HookExecutor] spawn` 来自 **acceptance.js 打印的 [99] 明细**（它把这两个字符串都打出来了）
 * 也就是说：**被检验者的输出混进了判据的原料里**，扫描器读到了被检验者自己写的话。
 * 这与 `src=host` 是同一个形状 —— 判据读到了它本该独立验证的那一方的自述。
 *
 * 所以必须认**真形状**：`[HookExecutor] spawn … cmd=bash "<路径>"`，
 * 且 `.check/` 出现在 `cmd=` **之后**。光在同一行里出现不算。 */
const RE_SPAWN = /\[HookExecutor\] spawn[^\n]{0,500}?cmd=([^\n]{0,400})/;

/* 【2026-09-15 加】宿主侧的**退出码**。
 * 为什么现在才加：我一直以为「宿主只记 spawn、不记返回值」，所以 [99] 只能拿 spawn 次数当判据。
 * 实测（20:1x 翻案）：宿主在 spawn 的**下一行**就写了 ——
 *   `[Warning] [HookExecutor] abnormal exit pid=… code=1 elapsed=195ms timedOut=false`
 *   `[Info] Hook exited with **non-blocking** error code 1: [immunity] 该文件命中已登记的失败模式：`
 * **返回值一直在日志里**，是我的正则只匹配了 `spawn` 行、没看它的下一行。
 * 有了它，[99] 才能做**真正的交叉核对**：宿主记的 `code=1` 次数 ↔ hook 自述的 `verdict=hit` 次数。
 * 两侧独立（宿主不依赖 hook 自述）—— 这正是「打架时信宿主」的前提。 */
const RE_HOOKEXIT = /\[HookExecutor\] abnormal exit[^\n]{0,400}?code=(-?\d+)/;
const RE_NONBLOCK = /Hook exited with non-blocking error code (-?\d+)/;

/* 【ISS-114 ② · 2026-09-17】自指污染的**第二形态**：**本文件的注释原文**。
 *
 * 2026-09-15 那次修法（见 `RE_SPAWN` 上方）要求 `cmd=` —— 它挡住了当时的来源
 * 「acceptance.js 打印的 [99] 明细」（含 `[HookExecutor] spawn` 与 `.check/`，但**没有 `cmd=`**）。
 * 但 `RE_SPAWN` 上方的注释**恰好**把 `cmd=bash "<路径>"` 写成了例子 ——
 * 于是**注释原文自己成了「真形状」的合格样本**：我在对话里读一次本文件，
 * 那段注释就进了会话记录行（`<ts> method:requests:result {…"instanceId"…}`），
 * 而会话记录行**和宿主行长得一样** → 被计成一次宿主 spawn / 异常退出。
 *
 * **实测（W23 J18 · 09-17 窗口 · 216 MB）**：含 `[HookExecutor] spawn` 的 54 行里
 * **31 行是会话记录行**；含 `[HookExecutor] abnormal exit` 的 31 行**全部**是会话记录行
 * （`code=1` 抄自上面那行注释的例子，`pid=…` 是省略号）→ **宿主真行 = 0**。
 * 后果：报出 27 次假的 `code=1` → `crossCheckHookExit`（「信宿主」）判 **FAIL = 纯假红**。
 * 同一窗口的**真数据**：宿主真行 spawn **23**（`immunity-hook.js` 21 · `setup.sh` 2）·
 * 宿主真行异常退出 **0** · 自述 `hit×1` → 按判据本该 **OK**。
 *
 * **★ 所以形状守卫不够 —— 形状可以被注释复制。** 必须再认**行类型**：
 * 会话记录行含 `"instanceId"` / `method:requests:`，宿主系统行不含。
 * 这个闸门放在扫描回调**开头**，一次保护所有分支（spawn / abnormal exit /
 * non-blocking / AutomationRecords）—— 它们都是「宿主事件计数」，语义一致。
 * **为什么不是「只要含 `.check/` 就不算」**：那会连真的 `immunity-hook.js` spawn 一起否掉。 */
const isSessionRecLine = (l) =>
  l.indexOf('"instanceId"') >= 0 || l.indexOf('method:requests:') >= 0;

/* 宿主日志行是 JSON，行首有 `"timestamp":"2026-09-15T06:34:43.244Z"`（UTC）。
 * 配对要靠它，所以必须取出来 —— 只有 id 和 status 是配不上的。
 * 取不到就返回 null，**不许拿「现在」顶替**：那会把配对准星悄悄挪到当下。 */
function parseHostTs(line) {
  const m = RE_TS.exec(String(line));
  if (!m) return null;
  const raw = m[1] !== undefined ? m[1] : m[2];
  const t = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/* 账本一行长这样（`acceptance.js` 自己写的）：
 *   2026-09-15T06:46:00.050Z exit=2 ok=7 fail=0 drift=0 unver=2
 * 认不出的行**直接丢掉并在调用方计入 unparsed**，不猜。 */
const RE_LEDGER = /^(\S+)\s+exit=(\d+)\s+ok=(\d+)\s+fail=(\d+)\s+drift=(\d+)\s+unver=(\d+)/;
function parseLedger(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    if (!l.trim()) continue;
    const m = RE_LEDGER.exec(l.trim());
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (!Number.isFinite(t)) continue;
    out.push({ t, exit: +m[2], ok: +m[3], fail: +m[4], drift: +m[5], unver: +m[6] });
  }
  return out;
}

/* 把「宿主说它触发了」与「程序说它产出了」配起来 —— 纯函数，自测能覆盖。
 * 窗口的取值与理由见下面 `PAIR_BEFORE_MS` / `PAIR_AFTER_MS` 的注释
 * （**别在这里复述窗口数字** —— 两处写同一个值就会分叉）。
 *
 * 四态，不许合并：
 *   UNVERIFIED = 没有这条 automation 的运行记录（**未到点**，不是「跑了没产出」）
 *   FAIL       = 运行记录在、但窗口内没有账本行（**跑了但没产出**）／运行本身失败
 *   DRIFT      = 运行记录在、status 认不出（**不许猜成成功**）
 *   OK         = 两边都在、时间对得上（另附 `cand` 候选行数与 `deltaMs`，供复核）
 */
/* 配对窗口：**[运行时刻 -15 分钟, 运行时刻 +30 分钟]**。
 *
 * 左边界原来是 2 分钟，**那是错的**（2026-09-15 改）。我按「账本行在运行记录之前几秒」
 * 估的，而探针实测的运行记录是在**整轮跑完之后**才落盘：
 * `execute start` 06:34:08 → `terminal run record written` 06:34:43（35 秒的活，
 * 记录写在收尾）。那条 automation 要跑的是 acceptance，约 4 分钟，
 * 跑完还要模型写汇报 —— **记录可能比账本行晚好几分钟**。
 * 2 分钟的左边界会把「跑了、也有产出」判成「触发了但没产出」= **假红**，
 * 而假红会训练人忽略红色，那比漏报更贵。
 *
 * 向右 30 分钟：acceptance 一次约 4 分钟，账本行写在它跑完之后。
 * 窗口内**可能不止一行**账本（我手动跑也会写一行），所以 OK 时把
 * 候选行数与 Δ 一起打出来 —— **配对是可复核的，不是隐藏假设**。 */
const PAIR_BEFORE_MS = 15 * 60 * 1000;
const PAIR_AFTER_MS = 30 * 60 * 1000;

/* 新鲜度闸门：运行记录超过这么久就算**陈旧**。
 *
 * 为什么必须有它：`daemon.log` 按 10 MiB 滚动，留存期只有约 1.5 天。如果日志里
 * 只剩一条三天前的运行记录，而账本里也只剩三天前那一行，两边**仍然配得上**
 * —— 会报出一个「很久以前它产出过」的 OK，而真正发生的事是「它已经三天没跑了」。
 * 陈旧的一对配在一起，不是证据，是巧合。
 *
 * 26 小时 = 日报周期 24h + 2h 宽限。**这个数字是策略，不是期望值**，
 * 所以它在这里而不在 baseline.json（baseline 装的是「应该跑出什么」）。
 * 超期一律报 UNVERIFIED —— 「日志滚掉了」与「日报停了」**无法区分**，
 * 而分不清的两件事不许猜成一件。 */
const PAIR_MAX_AGE_MS = 26 * 60 * 60 * 1000;

function pairRunWithLedger(runs, lines, id, opts) {
  const o = opts || {};
  const beforeMs = o.beforeMs === undefined ? PAIR_BEFORE_MS : o.beforeMs;
  const afterMs = o.afterMs === undefined ? PAIR_AFTER_MS : o.afterMs;
  const maxAgeMs = o.maxAgeMs === undefined ? PAIR_MAX_AGE_MS : o.maxAgeMs;
  const scanComplete = o.scanComplete === undefined ? true : o.scanComplete;
  const now = o.now === undefined ? Date.now() : o.now;

  const mine = (runs || []).filter((r) => r.id === id);
  const last = mine.length ? mine[mine.length - 1] : null;
  /* 【2026-09-16 · ISS-046】起点记录只用来**把话说准**，不参与配对。
   * 它回答的是「0 次终态」到底该读成什么：有起点 = **在跑**；没起点 = 真「未到点」。 */
  const starts = (o.starts || []).filter((r) => r.id === id);
  if (!last) {
    /* **扫不完就不许下否定结论。** 「没找到运行记录」在扫描不完整时推不出「没跑」
     * —— 那条记录可能就在没读到的那几个文件里。这是「没测」第三态，不是「没有」。 */
    if (!scanComplete) {
      return { state: 'UNVERIFIED', run: null, line: null,
        why: '扫描**未完成**（撞预算），所以「没有运行记录」不等于「没跑」—— ' +
          '记录可能就在没读到的文件里。**这一项没测，不是通过也不是失败**' };
    }
    /* 有起点、没终态 —— **必须与「从未触发」分开说**。两者的 `autoRuns` 都是 0，
     * 但一个是「正在跑」，一个是「没到点」。把它们打印成同一句话，
     * 就是 ISS-046 的原形：**把「正在跑」读成「没发生」。** */
    if (starts.length) {
      const st = starts[starts.length - 1];
      return { state: 'UNVERIFIED', run: null, line: null,
        why: '宿主有 **' + starts.length + ' 条 start 记录**（最近 ' +
          (st.t ? new Date(st.t).toISOString() : '时间戳未解析出') +
          '）但**没有终态记录** = **正在跑**（或那一轮崩了、没落终态）—— ' +
          '**不是「未到点」**。终态记录要等它跑完才写，约几分钟后再看' };
    }
    return { state: 'UNVERIFIED', run: null, line: null,
      why: '宿主日志里**既没有 start 记录也没有终态记录** = **未到点**（不是「跑了没产出」）' };
  }
  if (/FAIL|ERROR|REJECT|CANCEL/i.test(last.status)) {
    return { state: 'FAIL', run: last, line: null,
      why: '最近一次运行没成功（status=' + last.status + '）—— 看 daemon.log 里同一 automationId 的上下文' };
  }
  if (!/ACCEPT|SUCCESS|COMPLETE|OK/i.test(last.status)) {
    return { state: 'DRIFT', run: last, line: null,
      why: 'status=' + last.status + ' 不在已知枚举里 —— **不许猜成成功**，去 daemon.log 确认它是什么意思再更新基线' };
  }
  if (!last.t) {
    return { state: 'UNVERIFIED', run: last, line: null,
      why: '运行记录里没解析出时间戳 —— 配不上账本，**第三态**（不是通过）' };
  }
  const ageH = Math.round((now - last.t) / 3600000);
  if (now - last.t > maxAgeMs) {
    return { state: 'UNVERIFIED', run: last, line: null,
      why: '日志里最近一条运行记录已是 ' + ageH + ' 小时前（> ' + Math.round(maxAgeMs / 3600000) +
        'h）—— **「日志滚掉了」与「日报停了」无法区分**，所以是第三态，不猜成任何一种' };
  }
  const hit = (lines || []).filter((l) => l.t >= last.t - beforeMs && l.t <= last.t + afterMs);
  if (!hit.length) {
    return { state: 'FAIL', run: last, line: null, cand: 0, deltaMs: null,
      why: '宿主说它触发了（' + new Date(last.t).toISOString() + '，' + ageH + ' 小时前），但账本里 ' +
        Math.round(beforeMs / 60000) + ' 分钟前到 ' + Math.round(afterMs / 60000) +
        ' 分钟后这个区间内一行都没有 = **触发了，但没产出**。' +
        '这与「没触发」不是一回事：前者查命令为什么没跑到收尾，后者查调度' };
  }
  /* 取**最接近运行时刻**的那一行，不是最后一行 ——
   * 窗口里可能有多行（我手动跑也写），取最近的才是「这一次」的产出。 */
  const line = hit.reduce((a, b) => (Math.abs(b.t - last.t) < Math.abs(a.t - last.t) ? b : a));
  return { state: 'OK', run: last, line, cand: hit.length, deltaMs: line.t - last.t, why: '' };
}

/* ---- [98] 的因果链：这一次「产出」**是不是**这一轮 automation 干的 ------------
 *
 * 光按时间窗口配对，只能证明「那一刻**有人**跑过 acceptance」，证明不了**是它跑的**。
 * 这不是钻牛角尖：我的规矩是「会话第一件事跑 acceptance」，若 A 在 09:05 开会话、
 * 我在 09:05 手动跑一次，而日报 09:00 的运行记录在 09:04 落盘 ——
 * 两条时间线**正好落在同一个 ±15 分钟窗口里**，[98] 会给出一个假 OK，
 * 而它盖住的真实故障是：**日报根本没执行那条命令。**
 *
 * 宿主其实给了钥匙：运行记录里有 `sessionId`，而**工作区级 CLI host 日志**
 * （`logs/<日期>/<工作区名>__<hash>.log`）里记着那一轮执行过的**顶层命令全文**。
 * 于是因果链三段，**全在宿主侧或程序侧**，没有一段来自被检验者的自述：
 *   ① 宿主：automation X 跑了，status=ACCEPTED，sessionId=S
 *   ② 宿主：工作区日志里 sessionId 唯一=S，且其中执行过 `… acceptance.js …`
 *   ③ 程序：`acceptance.js` 跑到收尾写了账本行（时刻落在 ② 之后）
 *
 * 【2026-09-16 · ISS-051】② 的通道换过一次：原来读
 * `sdk/conversations/<sessionId>.log`，**那条通道对 automation 结构性无效**
 * （ACP 协议事件流，实测 `toolName` 0 次），恒返回 `[]` → 被读成「没有执行」。
 * 详见 `findSessionAcceptanceRuns` 上方。
 *
 * 实测（2026-09-15 探针 140c89de）：② 的命令时刻 1789460429022，
 * 任务输出的完成时刻 1789460552365，账本行 1789460552206 ——
 * **账本行比命令完成早 159 毫秒**。这不是「同一时间窗口」，这是同一件事。
 *
 * `cmds` 为 **null** 与为 **[]** 必须分开：
 *   null = 工具调用记录根本拿不到（**没信息**，第三态，退回时间窗口配对）
 *   []   = 拿到了，但里面没有那条命令（**确实没执行**，FAIL）
 * 把这两种压成一种，就会把「没测」读成「没跑」—— 同一个坑第三次出现了。
 *
 * 【2026-09-16】**第四次**：上游 `findSessionAcceptanceRuns` 把「通道读不出命令」
 * 也喂成了 `[]`（详见它上方）。所以现在它返回**三态**，第三种是 `null` 不是 `[]`。
 * 修法只落在**取数层**，本函数一字未改 —— 若改这里，会把「真·没执行」
 * 一起降级成 UNVERIFIED，那是往另一个方向出错（假绿/漏报）。
 */
const SESS_CMD_WIN_MS = 30 * 60 * 1000;

function dayOf(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 【2026-09-16 · 修 ISS-051】读某一轮 automation **执行过的顶层命令**。
 *
 * 通道换过一次，理由是一条实测：原来读 `logs/<日期>/sdk/conversations/<sessionId>.log`，
 * 而那条通道**对 automation 结构性无效** —— 该文件是 **ACP 协议事件流**
 * （2026-09-16 那一轮：90,271 条 `event-machine:dispatch`），
 * `"toolName"` / `"rawInput"` / `acceptance.js` **各 0 次**。
 * 于是恒返回 `[]` → 上层读成「**没有执行**」→ **对任何 automation 会话必然 FAIL**。
 * 而那一轮确实执行了：产物 `audit-010807.txt` 在，账本 01:19:09.987Z 有它写的一行。
 * **「测不了」被读成「没跑」——同一个坑第四次**（前三次见 `causalPair` 上方）。
 *
 * 真正的通道是**工作区级 CLI host 日志** `logs/<日期>/<工作区名>__<hash>.log`，
 * 行里 `[BashTool] execute start | command="…"` 记着**顶层命令全文**。
 *
 * 两个形状必须处理（都是实测踩出来的，不是设想的）：
 *   ① **归属只能靠自证**：`[BashTool]` 行**不含** sessionId；含 sessionId 的只有
 *      `[SessionRunStateMachine] … sessionId=<uuid>` 行。所以只有当该文件里 sessionId
 *      **恰好唯一**且等于目标时才可信。多于一个 = 并发 = **归属不了，宁可报 null**。
 *      （实测：9-16 的 `.workbuddy-ai__*.log` 里 sessionId 唯一 = `17823d81`；
 *        而 `workbuddy__*.log` 混着两个会话，用它就会错配。）
 *   ② **「执行」不是「提到」**：那一轮里 `grep -n '…' .check/acceptance.js` 出现 2 次
 *      （在**读**这个文件），子串判断会把它们当成「跑了 acceptance」。
 *      所以判据走 `cmdRunsAcceptance`：只认**被执行的目标**，且允许**一层**脚本指针链。
 *
 * 返回值三态，**不许压成两种**（这正是 ISS-051 的核心）：
 *   null = 没有可信文件（**没信息**）→ 上层 UNVERIFIED
 *   []   = 有可信文件，但里面没有执行 acceptance 的命令（**确实没执行**）→ 上层 FAIL
 *   数组 = 命中
 * fs 在这里，判定不在这里。 */
const RE_WS_TS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{4}) (上午|下午)(\d{1,2}):(\d{2}):(\d{2})\.(\d{3})\]/;
const RE_WS_RUN = /\b(?:node|bash|sh|source)\s+([^\s;&|"']+\.(?:js|sh))/g;

/* 工作区级日志的时间戳是 `[16/9/2026 上午9:08:07.359]`（12 小时制 + 中文上下午）。
 * `parseHostTs` 只认 ISO 串与毫秒数，**认不出这个形状** —— 而认不出就返回 null，
 * null 又被 `causalPair` 的 `Number.isFinite(c.t)` 过滤掉，
 * 于是「执行过」当场变「没执行」。**又一个「形状认不出 → 假阴性」。** */
function parseWorkspaceTs(line) {
  const m = RE_WS_TS.exec(line);
  if (!m) return null;
  let h = +m[5];
  if (m[4] === '下午' && h < 12) h += 12;
  if (m[4] === '上午' && h === 12) h = 0;
  return new Date(+m[3], +m[2] - 1, +m[1], h, +m[6], +m[7], +m[8]).getTime();
}

/* ── 「执行」的两种假绿向量（2026-09-16 实测，ISS-055）────────────────────
 * 只用 `RE_WS_RUN` 扫子串是不够的：下面**两条命令都没有执行 acceptance**，
 * 而旧实现两条都返回 true —— 方向是**假绿**（判据说「执行过」，实际没有）。
 *
 *   ① `echo "node .check/acceptance.js"`   ← 引号里只是**打印**出来
 *   ② `cat > notes.md <<'EOF'` … `node .check/acceptance.js` … `EOF`  ← 写进文件的数据
 *
 * 所以先剥掉「不是 shell 代码」的部分，再扫：heredoc 正文是数据；引号里的东西
 * **默认**也是数据 —— 例外只有一种：引号前面是**解释器 + -c/-e**（`bash -c "…"`、
 * `node -e "…"`），那才是真把引号内容当命令跑。
 * 反例要挡住：`grep -e "…"` 的 `-e` **不是**解释器的开关，不许放行。 */
const RE_WS_INTERP_C = /(?:^|[\s;&|(])(?:node|bash|sh|source)\s+-[A-Za-z]*[ce]\s*$/;

/* 剥掉 heredoc 正文（`<<[-]['"]?TAG` 到行首 TAG）。只留命令本身。 */
function stripHeredocs(cmd) {
  const lines = cmd.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(lines[i]);
    if (!m) continue;
    i++;
    while (i < lines.length && lines[i].trim() !== m[1]) i++;   /* 正文整段丢弃 */
  }
  return out.join('\n');
}

/* 按「引号内外」切段。`pre` = 该段引号**之前**那段未加引号的尾部（给 RE_WS_INTERP_C 用）。 */
function splitQuoted(cmd) {
  const out = [];
  let buf = '', quoted = false, q = '', pre = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quoted) {
      if (c === q) { out.push({ text: buf, quoted: true, pre }); buf = ''; quoted = false; pre = ''; }
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      out.push({ text: buf, quoted: false, pre: '' });
      pre = buf; buf = ''; quoted = true; q = c;
      continue;
    }
    buf += c;
  }
  out.push({ text: buf, quoted: false, pre: '' });
  return out.filter((s) => s.text.length > 0);
}

/* 这条命令**执行**了 acceptance 吗（而不是读它、或只是提到它）？
 * 只认 `node|bash|sh|source <目标>` 里的**目标**；目标若是别的脚本，读它看内容
 * —— **一层**指针链。不硬编码 `andyngo-audit.sh`：硬编码会腐烂（硬规则二十七）。 */
function cmdRunsAcceptance(cmd, wsRoot) {
  for (const seg of splitQuoted(stripHeredocs(cmd))) {
    if (seg.quoted && !RE_WS_INTERP_C.test(seg.pre)) continue;   /* 引号里的提到不算 */
    RE_WS_RUN.lastIndex = 0;
    let m;
    while ((m = RE_WS_RUN.exec(seg.text))) {
      const p = m[1];
      if (/(^|\/)acceptance\.js$/.test(p)) return true;
      try {
        if (fs.readFileSync(path.resolve(wsRoot, p), 'utf8').indexOf('acceptance.js') >= 0) return true;
      } catch (e) { /* 读不到就不算命中 —— 不许把「读不到」当「命中」 */ }
    }
  }
  return false;
}

/* 只读文件头 8 KB 判断这是不是工作区级 CLI host 日志。
 * 为什么要预筛：同一天目录里还有 8 MB 级的其他日志，为一个不相干的文件整读一遍不值。 */
function looksLikeWorkspaceLog(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.allocUnsafe(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).toString('utf8').indexOf('Workspace Path:') >= 0;
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* 关不掉就算了 */ } }
  }
}

/* `command="…"` 里的 `\"` / `\\` 是转义过的（日志按 JSON 串写）。 */
function unescapeLogCommand(rest) {
  let s = '';
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '\\') { if (rest[i + 1] !== undefined) s += rest[i + 1]; i++; continue; }
    if (c === '"') break;
    s += c;
  }
  return s;
}

function findSessionAcceptanceRuns(root, day, sessionId, ts) {
  if (!sessionId) return null;
  const days = [day];
  if (Number.isFinite(ts)) {
    const d2 = dayOf(ts);
    if (d2 !== day) days.unshift(d2);   /* 跨天的那一轮：按它自己的日期先找 */
  }
  const wsRoot = path.dirname(root);    /* root = <HOME>/logs，工作区根在它上一层 */
  let sawTrusted = false;               /* 见过可信文件吗 —— 这是 null 与 [] 的分界 */
  for (const d of days) {
    let names;
    try { names = fs.readdirSync(path.join(root, d)); } catch (e) { continue; }
    for (const nm of names) {
      if (!/\.log$/.test(nm)) continue;
      /* **必须用 readdirSync 而不是 glob**：工作区日志是 `.workbuddy-ai__*.log`，
       * 以 `.` 开头 = 隐藏文件，`ls *.log` 看不到它。 */
      const p = path.join(root, d, nm);
      if (!looksLikeWorkspaceLog(p)) continue;
      const sids = new Set();
      const cmds = [];
      try {
        eachLine(p, (line) => {
          const i = line.indexOf('[SessionRunStateMachine]');
          if (i >= 0) {
            const m = /sessionId=([0-9a-fA-F-]{36})/.exec(line.slice(i));
            if (m) sids.add(m[1]);
            return;
          }
          const j = line.indexOf('[BashTool] execute start');
          if (j < 0) return;
          const q = line.indexOf('command="', j);
          if (q < 0) return;
          cmds.push({ t: parseWorkspaceTs(line), cmd: unescapeLogCommand(line.slice(q + 9)) });
        });
      } catch (e) { continue; }
      /* **自证归属**：该文件里 sessionId 恰好唯一且等于目标，才可信。 */
      if (sids.size !== 1 || !sids.has(sessionId)) continue;
      sawTrusted = true;
      const out = [];
      for (const c of cmds) {
        if (!cmdRunsAcceptance(c.cmd, wsRoot)) continue;
        out.push({ t: c.t, cmd: c.cmd, done: true });
      }
      out.sort((a, b) => (a.t || 0) - (b.t || 0));
      if (out.length) return out;
      /* 可信但没命中：**先别返回 []** —— 同一天可能有多个工作区日志，继续找下一个。
       * 全找完仍没有，才是真的「没执行」。 */
    }
  }
  return sawTrusted ? [] : null;
}

/* 纯函数 —— 自测能覆盖（真实环境里「日报跑了但没执行命令」这一支等不到）。 */
function causalPair(run, cmds, lines, opts) {
  const o = opts || {};
  const afterMs = o.afterMs === undefined ? SESS_CMD_WIN_MS : o.afterMs;
  if (!run) return null;
  if (!cmds) {
    return { state: 'UNVERIFIED', causal: false,
      why: '拿不到这一轮的工具调用记录（sessionId=' + (run.sessionId || '无') +
        '）—— 工作区日志读不到，或该日志里 sessionId 不唯一（并发，归属不了）。' +
        '**因果没确认**，下面退回按时间窗口配（能证明「那一刻有人跑过」，证明不了**是它**）' };
  }
  const exec = cmds.filter((c) => Number.isFinite(c.t));
  if (!exec.length) {
    return { state: 'FAIL', causal: true,
      why: '这一轮 automation 的会话（' + run.sessionId + '）里**没有执行** `node .check/acceptance.js` ' +
        '—— 提示词没跑到那一步，或命令被跳过。这与「执行了但崩了」不是一回事，' +
        '查的方向不一样：前者看提示词，后者看命令' };
  }
  const cmd = exec[exec.length - 1];
  /* 下界取命令时刻（**不许提前**）：账本行只能写在命令之后。
   * 上界 30 分钟 —— 一次 acceptance 约 4 分钟，留到 30 是为慢机器留余量。 */
  const hit = (lines || []).filter((l) => l.t >= cmd.t && l.t <= cmd.t + afterMs);
  if (!hit.length) {
    return { state: 'FAIL', causal: true, cmd,
      why: '会话里执行了那条命令（' + new Date(cmd.t).toISOString() + '），但之后 ' +
        Math.round(afterMs / 60000) + ' 分钟内账本一行都没有 = **执行了，没跑到收尾**。' +
        '崩在收尾之前就不写账本，这是设计' };
  }
  const line = hit.reduce((a, b) => (Math.abs(b.t - cmd.t) < Math.abs(a.t - cmd.t) ? b : a));
  return { state: 'OK', causal: true, cmd, line, cand: hit.length, deltaMs: line.t - cmd.t, why: '' };
}

/* **分块读，不整读。** 实测（2026-09-15）：`logs/<日期>/sdk/conversations/` 里
 * 单个会话日志就有 **577 MB**，顶层 16 个文件合计 226 MB。原来用 `readFileSync` 整读 +
 * `split('\n')`，一次要占 ~1.2 GB 字符串，而且一撞预算就 break ——
 * 结果是**只读完顶层，一条 automation 记录都没读到**（`autoRuns=0`），
 * 而 [98] 会把它读成「未到点」。**这是「没扫完」伪装成「没有」。**
 *
 * 分块读之后内存是 O(块大小)，不是 O(文件)。
 * 只在 `\n` 处切分、**未成行的尾巴留在 carry 里** —— 于是特征串不会跨块被劈开
 * （正则里没有 `\n`），只认完整行这个性质保持不变。 */
function eachLine(file, onLine, chunkBytes) {
  const CH = typeof chunkBytes === 'number' ? chunkBytes : 8 * 1024 * 1024;
  const dec = new (require('string_decoder').StringDecoder)('utf8');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CH);
    let carry = '';
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CH, null);
      if (!n) break;
      carry += dec.write(buf.subarray(0, n));
      let pos = 0;
      for (;;) {
        const i = carry.indexOf('\n', pos);
        if (i < 0) break;
        onLine(carry.slice(pos, i));
        pos = i + 1;
      }
      carry = carry.slice(pos);   /* 只留未成行的尾巴，避免 O(n²) 的反复切片 */
    }
    if (carry) onLine(carry);
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* 关不掉也要把已读到的交出去 */ }
  }
}

/* 把「时间窗口配对」与「因果配对」合成一行结论 —— **纯函数，自测能覆盖**。
 *
 * 为什么连这几行也要提成纯函数：这段是 `[98]` 的**输出层**，而它在真实环境里
 * 只有等日报真的跑过一次才会被执行到。留在 `acceptance.js` 里就是**没跑过的代码** ——
 * 而没跑过的代码崩起来是「一行结论都没有、退出码 1」（TDZ 那次已经领教过）。
 * 「判据要由程序生产」的另一面是：**判据的展示层也得被跑过。** */
function combinePair(p, q) {
  const use = (q && q.state !== 'UNVERIFIED') ? q : p;
  const pairTxt = (use.deltaMs === null || use.deltaMs === undefined) ? ''
    : ' · 配对：账本行比' + (use.causal ? '命令执行' : '运行记录') +
      (use.deltaMs >= 0 ? '晚 ' : '早 ') + Math.abs(Math.round(use.deltaMs / 1000)) +
      's（窗口内候选 ' + use.cand + ' 行）';
  /* `q.causal` **不能**用来渲染这句话：`causalPair` 的两个 FAIL 分支也返回
   * `causal: true`（在那边它的语义是「因果链**已判定**」，不是「因果成立」）。
   * 用它渲染，就会在 FAIL 那一行同时打印「因果已确认（…执行过…）」——
   * **同一行自相矛盾**，而且实测真的打出来过（`audit-013123.txt:13`）。
   * 自测 35 只断言了 `state` 与 `why`、**没断言 `causalTxt`** —— 这就是它漏网的原因。 */
  const causalTxt = !q ? ''
    : q.state === 'OK'
      ? ' · **因果已确认**（那一轮的会话里执行过 `node .check/acceptance.js`）'
      : q.state === 'FAIL'
        ? (q.cmd
          ? ' · **因果已确认，但没跑到收尾**（执行过，账本没跟上）'
          : ' · **因果已判定：不是它**（那一轮的会话里没有执行那条命令）')
        : ' · **因果未确认**（只有时间窗口重合）';
  /* q 是 UNVERIFIED 时**两个都讲**：因果没确认，以及退回后的时间窗口结论。
   * 只报一个，就会把「因果没确认」讲成「通过」或反过来。 */
  const why = (q && q.state === 'UNVERIFIED')
    ? q.why + ' ｜ 时间窗口配对：' + (p.why || p.state) : use.why;
  return { state: use.state, pairTxt, causalTxt, why, causal: !!(q && q.causal) };
}

/* hook **自己**写的东西在哪 —— **不写死，走指针链**：
 *   settings.json（hook 命令）→ 命令里的 `.check/*.js` 脚本 → 脚本里的 `TRACE = '…'`
 *
 * 为什么要走链：原来 `[99]` 的自述核对直接读 `.check/hook.log`（**0 行**），
 * 而 hook 真正的落点是另一个工作区下的 `immunity/host-hook-spawns.log`。
 * 找错落点的后果不是「少看一点」：它会让「宿主调了但它自己没记上」这句警告**永远误报**，
 * 反过来又支持了「hook 没生效」这个错误结论。
 * 写死一个路径会腐烂（硬规则二十七），所以每次都从配置现推。 */
/**
 * 找 hook 的**自述产出**落点，并读它。
 *
 * **落点不许写死**（硬规则二十七：权威放「会自己失效」的地方）。走指针链：
 *   settings.json 的 hooks[].command → 命令里指向 `.check/` 的 .js → 脚本里的 TRACE = '…'
 * 2026-09-15 踩过：`[99]` 一直读 `.check/hook.log`（0 行）当自述证据，
 * 而真正的落点在**另一个工作区**下的 `immunity/host-hook-spawns.log`（140 行）。
 * 读错落点 = 拿「空」当「没发生」，形状与「扫不完却报没有」一致。
 *
 * **返回的是佐证，不是判据**（硬规则二十八）：这个文件是 hook 自己写的，
 * 能被伪造，所以它可以**加强**结论，不能**单独支撑**结论。判据在宿主日志那一侧。
 */
/* 【2026-09-15 加】**「没被检查」与「检查了」必须分开数。**
 *
 * 上面那一版只数 `verdicts` 与 `rcNonZero` —— 那会让 `[99]` 的下游**只看行数**。
 * 而 `no-file-path` / `bad-json` / `no-payload` / `stdin-error` 这四种形状
 * **一行都代表「这次编辑没被检查」**：钩子拿到 payload 就退了，压根没走检查。
 * 危险在于它们**让行数变多**：宿主若改了 payload 形状（matcher 里就写着 `MultiEdit`，
 * 而 MultiEdit 的 payload 是 `edits` 数组、没有 `file_path`），
 * 所有编辑都会变成 `no-file-path` → 行数暴涨 → 「有产出」→ `[99]` 报 OK。
 * **全量漏检而验收全绿。** 这就是「走不到的分支和不存在的分支长得一样」。
 *
 * 分两档（约定 7：第三态不许并进「空」）：
 *   `unchecked`  —— **没走到检查**（stdin-error / no-payload / bad-json / no-file-path）
 *   `incomplete` —— **走到了检查但没完成**（non-clean:rc=N，扫描错误/入口异常）
 * 两档都意味着「这次编辑没被有效检查」，但原因不同、修法不同，所以分开报。 */
const UNCHECKED = new Set(['stdin-error', 'no-payload', 'bad-json', 'no-file-path']);

function findHookTrace(home) {
  const H = home || HOME;
  const out = { path: null, n: 0, last: null, why: null, verdicts: {}, rcNonZero: 0,
    unchecked: 0, uncheckedKinds: {}, incomplete: 0 };
  let script = null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(H, 'settings.json'), 'utf8'));
    for (const k of Object.keys(j.hooks || {})) {
      for (const g of (j.hooks[k] || [])) {
        for (const h of (g.hooks || [])) {
          const m = /"([^"]+\.js)"/.exec(String(h.command || ''));
          if (m && /[\\/]\.check[\\/]/.test(m[1])) script = m[1];
        }
      }
    }
  } catch (e) { out.why = 'settings.json 读不到：' + e.message; return out; }
  if (!script) { out.why = 'settings.json 里没有指向 .check/ 的 hook'; return out; }
  let src;
  try { src = fs.readFileSync(script, 'utf8'); }
  catch (e) { out.why = 'hook 脚本读不到：' + script; return out; }
  /* 形状要**跟着 hook 走**。2026-09-15 给 TRACE 加了 `process.env.IMMUNITY_TRACE ||` 前缀
   * （让测试夹具能写别处、不污染真日志），结果这条正则当场认不出新形状：
   * `[99]` 报 FAIL「spawn 了但没产出」—— **判据没跟着被改的代码走**，
   * 与「改动只落在一条路径上，另一条路径照旧用」同族。
   * 所以允许可选的环境变量前缀，并且自测里**两种形状各放一条 fixture**。 */
  const mt = /TRACE\s*=\s*(?:process\.env\.\w+\s*\|\|\s*)?'([^']+)'/.exec(src);
  if (!mt) { out.why = 'hook 脚本里没有 TRACE 落点'; return out; }
  out.path = mt[1];
  try {
    const lines = fs.readFileSync(out.path, 'utf8').split('\n').filter(Boolean);
    out.n = lines.length;
    out.last = lines.length ? lines[lines.length - 1] : null;
    /* **spawn 了 ≠ 跑成了。** 分两个维度数：
     *   verdict = hook 自己的判定；rc = 退出码（rc!=0 时宿主会拦截那次工具调用）。
     * 只看行数会把「跑了 140 次、每次都失败」读成「正常」。 */
    for (const l of lines) {
      /* 取到空白为止：verdict 可能是 `non-clean:rc=2`，
       * 用 `[a-z_]+` 会被截成 `non` —— 三种失败形状合成一种，看不出差别 */
      const mv = /\bverdict=(\S+)/.exec(l);
      if (mv) {
        const v = mv[1];
        out.verdicts[v] = (out.verdicts[v] || 0) + 1;
        /* 「没走到检查」逐类计数 —— 只报总数会看不出是宿主没递 payload
         * 还是递的形状变了（MultiEdit），两者修法不同。 */
        if (UNCHECKED.has(v)) {
          out.unchecked++;
          out.uncheckedKinds[v] = (out.uncheckedKinds[v] || 0) + 1;
        }
        if (v.startsWith('non-clean')) out.incomplete++;
      }
      const mr = /\brc=(\d+)/.exec(l);
      if (mr && +mr[1] !== 0) out.rcNonZero++;
    }
  } catch (e) { out.why = 'TRACE 文件读不到（hook 从没写成功过）'; }
  return out;
}

function scanHostLogs(logsDir, budgetBytes) {
  const root = logsDir || path.join(HOME, 'logs');
  const out = {
    ok: false, why: null, day: null, files: 0, complete: true,
    spawnTotal: 0, mine: 0, autoRuns: [], autoStarts: [],
    hookExits: 0, hookExitCodes: {}, nonBlocking: 0,
    scannedBytes: 0, coverage: null,
    /* 【2026-09-17 加 · ISS-116】两个新字段，都只为「说清窗口有多大」：
     *   · `dayHasHostLogs` —— 选中的日期目录里**有没有顶层 `.log` 文件**（宿主日志）。
     *     没有 → 这个窗口**根本装不了 spawn 行** → 「0 次」不是证据。
     *   · `newestMtime` —— 窗口内**最新**一个候选文件的 mtime（取**全部候选**，不只是扫到的 ——
     *     撞预算被跳过的那个可能正是最新的，用「扫到的」会把窗口算旧）。
     *     用途：与 hook 自述的**末行 ts** 比 —— 窗口比自述还旧 → 两个计数**不可比**。 */
    dayHasHostLogs: false, newestMtime: 0,
    /* 【2026-09-17 加 · ISS-114】按 hook 分组的 spawn 计数 —— **纯报告，不判红**。
     * 理由与「为什么不判红」见扫描循环里的那段注释。 */
    byHook: {}, noHookName: 0,
  };

  let days = [];
  try {
    days = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch (e) {
    out.why = 'logs 目录读不到：' + e.message;
    return out;
  }
  if (!days.length) { out.why = 'logs 下没有日期目录'; return out; }
  /* 【2026-09-17 改 · ISS-116】取「**最后一个含顶层 `.log` 文件的**日期目录」，
   * 而不是「最后一个日期目录」。原写法（`days[days.length - 1]`）有一条实测出来的假红：
   *
   *   **本地 00:00 宿主会先建新日期目录**（`logs/2026-09-17/`，**只含 `sdk/`**），
   *   而**当前这个宿主进程仍在写它前一天打开的那份日志** —— 实测 `logs/2026-09-16/*.log`
   *   里的 spawn 从 **798 涨到 803**（跨过午夜之后）。于是原写法把窗口切到了一个
   *   **没有任何宿主日志**的目录 → `[99]` 数到 `mine = 0`，而 hook 自述是**累积**的
   *   （1211 行，不按天截断）→ 命中 `mine === 0 && tr.n > 0` 那一支 → 判
   *   「自述不可信（或落点被伪造）。信宿主」= **假红**，而且**每次跨午夜都会出现**。
   *   **在固定时刻必假红的断言会被训练成忽略（DEC-019）—— 那比没有判据更坏。**
   *
   * **窗口的定义**：「宿主在写的那一天」而不是「日历上的最后一天」。
   * **回退**：若**没有任何**日期目录含顶层 `.log`，仍取最后一个日期目录（保持原行为），
   * 并把 `dayHasHostLogs = false` 记下来 —— 由 `[99]` 决定这是「没测」而不是「假红」。 */
  let day = days[days.length - 1];
  out.dayHasHostLogs = false;
  for (let i = days.length - 1; i >= 0; i--) {
    let has = false;
    try {
      has = fs.readdirSync(path.join(root, days[i])).some((f) => f.endsWith('.log'));
    } catch (e) { has = false; }
    if (has) { day = days[i]; out.dayHasHostLogs = true; break; }
  }
  out.day = day;

  const targets = [];
  const dayDir = path.join(root, day);
  try {
    for (const f of fs.readdirSync(dayDir)) if (f.endsWith('.log')) targets.push(path.join(dayDir, f));
  } catch (e) { out.why = '读不到 ' + day + '：' + e.message; return out; }
  /* automation 的会话日志在子目录里（理由见文件头）：**不扫它就等于砍掉 [98] 的因果链，
   * 并且让 [99] 那句否定超出证据覆盖范围。** */
  const convDir = path.join(dayDir, 'sdk', 'conversations');
  try {
    for (const f of fs.readdirSync(convDir)) if (f.endsWith('.log')) targets.push(path.join(convDir, f));
  } catch (e) { /* 没有这个目录不算致命 —— 但要在下面记一笔，别让 [99] 的否定悄悄变强 */ }
  try {
    for (const f of fs.readdirSync(root)) {
      /* 不跳过 `daemon.old.log` —— 理由见文件头（留存期是约束，陈旧由新鲜度闸门处理）。 */
      if (f.endsWith('.log')) targets.push(path.join(root, f));
    }
  } catch (e) { /* 根目录读不到不算致命：会话日志已经拿到了 */ }

  /* 【2026-09-15 改】扫描顺序与超预算行为 —— 两处都改，理由是一条实测数据：
   * `BUDGET` = **2 GiB**，而 `logs/` 共 **3.2 G**、光今天的目录就 **2.1 G**
   * （26 个文件，最大的三个是 `sdk/conversations/*.log`：607 / 574 / 517 MB）。
   * **必然撞预算** —— 于是这两处行为就决定了「未扫完」到底漏掉了什么：
   *   ① 原来按 `readdir` 原始顺序，与新鲜度无关 —— 最该看的今天的记录可能排在后面。
   *      改成**按 mtime 倒序**（最新优先）：真要漏，漏的是最旧的。
   *   ② 原来 `if (st.size > budget) { complete = false; break; }` ——
   *      **一个装不下的文件就把后面全部放弃**。改成 `continue`：跳过装不下的、
   *      继续扫装得下的，最大化覆盖的**文件数**。
   *   ③ 新增 `coverage` —— 「未扫完」必须**有量纲**：
   *      「否定的强度不能超过证据的覆盖范围」，前提是**知道覆盖范围有多大**。 */
  const sized = targets.map((p) => {
    let st = null;
    try { st = fs.statSync(p); } catch (e) { /* 下面按 null 丢掉 */ }
    return { p, size: st && st.isFile() ? st.size : null, mtime: st ? +st.mtimeMs : 0 };
  }).filter((t) => t.size !== null);
  sized.sort((a, b) => b.mtime - a.mtime);
  /* 窗口的**最新时刻**（ISS-116）—— 取**全部候选**，含被预算跳过的那些：
   * 被跳过的最新那个文件如果没算进来，窗口会被算旧 → 下游会误报「窗口比自述还旧」。 */
  out.newestMtime = sized.reduce((mx, t) => (t.mtime > mx ? t.mtime : mx), 0);

  const totalBytes = sized.reduce((s, t) => s + t.size, 0);
  let budget = typeof budgetBytes === 'number' ? budgetBytes : BUDGET;
  const skipped = [];
  for (const t of sized) {
    /* 装不下就**跳过它、继续扫后面的**（原来这里是 break —— 一个 607 MB 的文件
     * 排在前面就会让后面所有小日志一个都不扫）。 */
    if (t.size > budget) { skipped.push(t); continue; }
    const p = t.p;
    try {
      eachLine(p, (l) => {
        /* 【ISS-114 ② · 2026-09-17】自指污染闸门 —— 会话记录行**不是宿主记录**。
         * 一次保护下面所有分支（spawn / abnormal exit / non-blocking / AutomationRecords）。
         * 实测依据与「为什么形状守卫不够」见 `isSessionRecLine` 上方。 */
        if (isSessionRecLine(l)) return;
        if (l.indexOf('[HookExecutor] spawn') >= 0) {
          /* 认**真形状**，不是「同一行里两个串都有」—— 理由见 `RE_SPAWN` 上方。
           * 顺带：`spawnTotal` 也只数真 spawn 行，否则它会把 acceptance 自己打印的
           * 那行明细算成一次宿主 spawn。 */
          RE_SPAWN.lastIndex = 0;
          const ms = RE_SPAWN.exec(l);
          if (!ms) return;   /* 这里是逐行回调，不是循环体 —— continue 会直接语法错 */
          out.spawnTotal++;
          /* 只认宿主 spawn 的。**我自己在 Bash 里跑 hook 也含 `.check/`**，
           * 但那行走的是 `[BashTool] execute start`，不会进这个分支。 */
          /* **分隔符无关**：Windows 上 spawn 出来的是**反斜杠**
           * （`C:\Users\…\.check\immunity-hook.js`），只认正斜杠会把它们**全部漏掉**
           * —— 而漏掉的表现是「宿主从未 spawn 过它」= **一个由判据形状制造的假阴性**。
           * 2026-09-15 实测：真 129 次，全用反斜杠，判据报了 0。 */
          if (/\.check[\\/]/.test(ms[1])) out.mine++;
          /* 【2026-09-17 加 · ISS-114】**按 hook 分组** —— 纯报告，**不判红**。
           *
           * **为什么要**：`mine` 数的是「cmd 里含 `.check/` 的 spawn」**总数** —— 只要
           * **任何一个** `.check/` hook 在跑它就 > 0，所以「某一个登记在册的 hook 静默失效」
           * **看不见**（ISS-114 ①，`hook-session-start.js` 从未被加载就是这样被漏掉的）。
           * 分组之后，**谁在跑、谁一次没跑，看一眼就知道**。
           *
           * **为什么只报告不判红**（这是刻意的，不是没做完）：
           *   ① 判红需要一份「**应当**被 spawn 的名单」，而 `hook-session-start.js` 已由
           *      **DEC-041** 裁决「**不再要求被加载**」→ 名单必须能表达「已知未加载 + 理由」；
           *   ② 那是**改门禁语义**（**乙类**，ISS-114 原文即如此分类）→ 本文件不擅自决定；
           *   ③ 判红会引入**新的假红面** —— 有的 hook 类型本来就不在一个窗口内触发
           *      （如会话级 hook），拿「窗口内 0 次」当红，就是刚在 ISS-116 里修掉的那种错。
           *   **先让它可见；要不要变成红，是一个有独立代价的决定。**
           *
           * **取「最后一个脚本名」**：cmd 常见两种形态 ——
           *   `node "…/.check/immunity-hook.js"`（一个）
           *   `bash "…/.check/hook-post-edit.sh" hook-session-start.js`（两个，**后者才是 hook**）
           * 取最后一个与「哪个 hook 被调起」一致。
           * **实测（2026-09-16 窗口）**：`immunity-hook.js` 766 · `setup.sh` 54（**插件**，
           * 不指向 `.check/`）· `save-on-subagent-stop.mjs` 7（插件）· `noHookName` 0。
           * 另：`mine` 那 766 条**全部**是 `immunity-hook.js`，**噪声 0** ——
           * 也就是说 ISS-114 的 ②「自指污染」在**当前实现下已不成立**（见 CHG-190 的实测）。 */
          const hk = /([\w.\-]+\.(?:js|mjs|cjs|sh|cmd|bat|exe))\b/g;
          let hlast = null, hx;
          while ((hx = hk.exec(ms[1])) !== null) hlast = hx[1];
          if (hlast) out.byHook[hlast] = (out.byHook[hlast] || 0) + 1;
          else out.noHookName++;
        }
        /* 宿主记的**退出码**（spawn 的下一行）。理由见 RE_HOOKEXIT 上方。 */
        if (l.indexOf('[HookExecutor] abnormal exit') >= 0) {
          RE_HOOKEXIT.lastIndex = 0;
          const mx = RE_HOOKEXIT.exec(l);
          if (mx) { out.hookExits++; out.hookExitCodes[mx[1]] = (out.hookExitCodes[mx[1]] || 0) + 1; }
        }
        if (l.indexOf('Hook exited with non-blocking') >= 0) {
          RE_NONBLOCK.lastIndex = 0;
          if (RE_NONBLOCK.test(l)) out.nonBlocking++;
        }
        if (l.indexOf('[AutomationRecords] terminal run record written') >= 0) {
          RE_AUTO.lastIndex = 0;
          const m = RE_AUTO.exec(l);
          /* 带上 `t` 与 `sessionId` —— 缺了时间戳就配不上账本（「触发过」永远变不成
           * 「有产出」），缺了 sessionId 因果链就退化成「同时发生」。 */
          if (m) out.autoRuns.push({ id: m[1], status: m[2], t: parseHostTs(l),
            sessionId: m[3] || null, finishedAt: m[4] ? +m[4] : null });
        }
        /* ISS-046：起点记录**单独收**，不进 `autoRuns`（理由见 RE_AUTO_START 上方）。
         * 它唯一的用途是让 `[98]` 能说出「start N 条 / 终态 M 条」——
         * N > M 就是**正在跑**，N == M == 0 才是真的「未到点」。 */
        if (l.indexOf('[AutomationRecords] startRunRecord written') >= 0) {
          RE_AUTO_START.lastIndex = 0;
          const ms2 = RE_AUTO_START.exec(l);
          if (ms2) out.autoStarts.push({ id: ms2[1], t: parseHostTs(l),
            startedAt: ms2[2] ? +ms2[2] : null });
        }
      });
    } catch (e) { continue; }
    budget -= t.size;
    out.files++;
    out.scannedBytes += t.size;
  }
  /* `complete` 的语义跟着改：原来 = 「没撞预算」，现在 = 「**没有被跳过的文件**」。
   * 后者更准确 —— 撞预算但把小的都扫了，和「有一个文件根本没看」是两件事。 */
  out.complete = skipped.length === 0;
  out.coverage = {
    files: sized.length, scanned: out.files, skipped: skipped.length,
    bytes: totalBytes, scannedBytes: out.scannedBytes,
    /* 跳过的是哪几个、多大 —— 报出来，别让「未扫完」变成一个没有量纲的形容词。 */
    skippedList: skipped.map((t) => ({ name: path.basename(t.p), mb: Math.round(t.size / 1048576) })),
  };
  out.ok = true;
  return out;
}

/* 纯函数：宿主侧的退出码 ↔ hook 自述的 verdict **交叉核对**。
 *
 * 为什么这算真正的独立判据：宿主的记录**不经过 hook**（宿主自己观测子进程的退出码），
 * 而 TRACE 是 hook 自己写的 —— 我亲手伪造过 4 行 `src=host`（存档 `.check/hook.log.forged-2026-09-15`）。
 * 两侧一致才有意义；打架时按硬规则二十八**信宿主**。
 *
 * 判据（2026-09-15 定）：
 *   · `code=1` 是「命中已登记失败模式」的退出码（见 `immunity-hook.js` 的 TRACE）。
 *   · **两个窗口不一样大**：TRACE 是**累积文件**（一直追加），宿主日志**按大小滚动**。
 *     所以宿主侧的计数天然是 TRACE 的**子集** —— 只判「宿主 > 自述」（自述漏了），
 *     不判「宿主 < 自述」（那可能只是日志滚走了）。
 *   · 只判这个上界是为了**不引入假红**：假红会训练人忽略红色。
 */
function crossCheckHookExit(host, trace) {
  const hostHit = (host.hookExitCodes || {})['1'] || 0;
  const selfHit = ((trace || {}).verdicts || {})['hit'] || 0;
  if (hostHit > selfHit) {
    return { state: 'FAIL', hostHit, selfHit,
      why: '宿主记了 ' + hostHit + ' 次 `code=1`，而 hook 自述只有 ' + selfHit +
        ' 次 `verdict=hit` —— **自述漏了**（或 TRACE 被截断）。信宿主' };
  }
  if (hostHit === 0 && selfHit > 0) {
    return { state: 'OK', hostHit, selfHit,
      why: '宿主窗口内没看到 `code=1`，但自述有 ' + selfHit + ' 次 —— ' +
        '**两个窗口不一样大**（宿主日志按 10 MiB 滚动、TRACE 是累积文件），不是矛盾' };
  }
  return { state: 'OK', hostHit, selfHit, why: '' };
}

/* 纯函数：`[99]` 在「有产出」分支里的**总判定**。
 *
 * 顺序有讲究 —— **先判漏检，再判自述漏记**：
 *   · `unchecked > 0`   = 钩子拿到 payload 就退了，**这次编辑根本没被检查**。
 *   · `incomplete > 0`  = 走到了检查但没完成（`non-clean:rc=2/3/4`）。
 *   两者都是「**漏检**」，比「自述漏记一次命中」严重得多 —— 后者只是账不平，
 *   前者是防线破了。所以漏检优先报红，不给「账目一致」掩盖它的机会。
 *
 * 为什么必须单独判这一条（而不是只看 `tr.n > 0`）：
 *   这四种形状**会让行数变多**。宿主若改了 payload 形状（matcher 里就写着 `MultiEdit`，
 *   而 MultiEdit 递的是 `edits` 数组、没有 `file_path`），所有编辑都会变 `no-file-path`
 *   → 行数暴涨 → 「有产出」→ 旧判据报 OK。**全量漏检而验收全绿。**
 *   与「走不到的分支和不存在的分支长得一样」同族。
 *
 * 会不会太激进？真 TRACE 里这几种形状**已经归零**（探针污染的 12 行已归档，
 * 且探针改走临时 TRACE 不再写真日志）→ 今后**再出现就是真信号**，报红是应该的。
 */
function judgeHookTrace(host, trace) {
  const tr = trace || {};
  const bad = (tr.unchecked || 0) + (tr.incomplete || 0);
  if (bad > 0) {
    const kinds = Object.keys(tr.uncheckedKinds || {}).sort()
      .map((k) => k + '×' + tr.uncheckedKinds[k]);
    if (tr.incomplete) kinds.push('non-clean:rc≠0×' + tr.incomplete);
    return { state: 'FAIL', bad, why:
      '**有 ' + bad + ' 次调用没被有效检查**（' + kinds.join(' ') + '）—— ' +
      '「有产出」不等于「检查了」。逐行看 TRACE 的 ts 与 fp：' +
      '若是 `no-file-path` 而宿主用了 MultiEdit，说明钩子需要支持 `edits` 数组' };
  }
  return crossCheckHookExit(host, tr);
}

/* 纯函数：宿主 hook **登记表** ↔ 本窗口实际 spawn 的 hook（**ISS-114 ① · 门禁**）。
 *
 * **它补的是什么洞**：`mine` 数的是「cmd 里含 `.check/` 的 spawn **总数**」——
 * 只要**任何一个** `.check/` hook 在跑它就 > 0，所以「**某一个**登记在册的 hook
 * 静默失效」**看不见**（`hook-session-start.js` 从未被加载就是这样被漏掉的）。
 *
 * 判据（与 X1 的 `exit-codes.md` **同族**：登记 + 未登记报警 + 悬空报警）：
 *   · 登记为「**必须**」的 hook，本窗口 `byHook` 里**一次都没有** → **FAIL**
 *   · 登记为「**允许缺席**」的 → 打印，**不判红**（理由必须写在表里）
 *   · `byHook` 里**未登记**的 → 打印，**不判红**（铁律 5：否则每次插件更新都会红）
 *   · 登记表读不到 / 一条有效登记都没有 → **UNVERIFIED**（不是通过，也不是失败）
 *
 * **为什么是纯函数（`text` 由调用方读进来）**：`selftest-host-log.js` 要能造
 * 红 / 绿两态 —— 判红逻辑必须能在**不碰真实日志、不碰真实登记表**的前提下被双向测
 * （同 `judgeHookTrace` / `crossCheckHookExit`）。
 *
 * **为什么名单必须能表达「允许缺席 + 理由」**：本窗口的宿主是 WorkBuddy，
 * 而 `hook-post-edit.sh` / `hook-session-start.js` 登记在 **`~/.codebuddy/settings.json`**
 * （另一个产品）→ 写「必须」就是**假红**。这正是 `[99]` 注释里警告过的「新的假红面」。
 * 实测（W23 J18 · 09-17 窗口）：`byHook = {immunity-hook.js 21 · setup.sh 2}`，
 * 那两条**一次都没出现**，而 `immunity-hook.js` 21 次 —— 门禁对前者报红就是错的。 */
function judgeHookRegistry(byHook, text) {
  const bh = byHook || {};
  if (typeof text !== 'string' || !text.trim()) {
    return { state: 'UNVERIFIED',
      why: 'hook 登记表读不到 / 是空的 → 这一项**没测**（不是通过，也不是失败）' };
  }
  const must = [];      // { name, why }
  const optional = [];  // { name, why }
  for (const line of text.split('\n')) {
    if (line[0] !== '|') continue;
    const cells = line.split('|').map((c) => c.trim());
    /* cells: [0]='' · [1]=脚本名 · [2]=事件 · [3]=期望 · [4]=理由 */
    const m = /`([^`]+)`/.exec(cells[1] || '');
    if (!m) continue;                        // 表头行 / `|---|` 分隔行
    const name = m[1], want = cells[3] || '', why = cells[4] || '';
    if (want.indexOf('必须') >= 0) must.push({ name, why });
    else if (want.indexOf('允许缺席') >= 0) optional.push({ name, why });
    else return { state: 'FAIL',
      why: '登记表里 `' + name + '` 的「期望」列既不是「必须」也不是「允许缺席」：`' + want + '`' };
  }
  if (!must.length && !optional.length) {
    return { state: 'UNVERIFIED', why: '登记表里一条有效登记都没有 → 这一项**没测**' };
  }
  const missing = must.filter((e) => !(bh[e.name] > 0));
  const unreg = Object.keys(bh).filter(
    (k) => !must.some((e) => e.name === k) && !optional.some((e) => e.name === k));
  const bhTxt = Object.keys(bh).length
    ? Object.keys(bh).sort().map((k) => k + ' ' + bh[k]).join(' · ') : '(空)';
  const parts = ['登记 ' + must.length + ' 必须 / ' + optional.length + ' 允许缺席',
    '本窗口 byHook ' + bhTxt];
  if (unreg.length) parts.push('**未登记却在跑**：' + unreg.sort().join(' · ') + '（只报告）');
  if (missing.length) {
    return { state: 'FAIL', missing: missing.map((e) => e.name), unreg,
      why: parts.join(' · ') + ' —— **登记为「必须」的 hook 在本窗口一次都没被 spawn**：' +
        missing.map((e) => '`' + e.name + '`').join(' · ') };
  }
  return { state: 'OK', missing: [], unreg,
    why: '门禁：登记 ' + must.length + ' 必须（**全部出现**）/ ' + optional.length + ' 允许缺席' +
      (unreg.length ? ' · **未登记却在跑**：' + unreg.sort().join(' · ') + '（只报告）' : '') };
}

module.exports = {
  scanHostLogs, HOME,
  parseHostTs, parseLedger, pairRunWithLedger,
  findSessionAcceptanceRuns, causalPair, combinePair, dayOf, findHookTrace,
  parseWorkspaceTs, cmdRunsAcceptance,
  crossCheckHookExit, judgeHookTrace, judgeHookRegistry,
  PAIR_BEFORE_MS, PAIR_AFTER_MS, PAIR_MAX_AGE_MS, SESS_CMD_WIN_MS,
};
