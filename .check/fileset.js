'use strict';
/* fileset.js —— 文件集的**唯一**定义：`MODE.md` 打头，`refs/*.md` 按名排序跟在后面。
 *
 * 为什么单独一个文件：`check-protocol.js` 和 `run-battery.js` 都要它。
 * **复制两份就会静默分叉** —— 而分叉最危险的地方在于它不报错。
 * （实测代价：run-battery.js 没跟上文件集，三套电池一次跑出 36 条「锚点失配」——
 *   那是「这条变异根本没跑」，与「逃逸」完全不是一回事。跑一套电池的回归等于没有回归。）
 *
 * 返回 { text, segs }：segs 记录每段在拼接文本里的起止，
 * 用来把全局行号还原成「哪个文件第几行」——没有这层还原，报出来的行号会指向另一个文件。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOME = path.resolve(__dirname, '..');
const MODE = path.join(HOME, 'MODE.md');
const REFS = path.join(HOME, 'refs');

/* 冻结档案：**逐字节拆出来的历史正文，不进检查范围**。
 *
 * 为什么要有这个清单：拆文件不等于内容少了 —— 检查范围跟着搬，就必然把
 * 以前不在范围里的东西一起搬进来。`refs/SOUL-lessons.md` 是从 SOUL.md 逐字节拆出的，
 * 而 **SOUL.md 从来不在检查范围里**。把它并进来，立刻多出 6 条红：
 * `.chk/run_all.sh` / `engine/measure.js` / `~/.workbuddy-ai/agents/x.md` 这些
 * 当时就不存在（或已不存在）的路径，以及一处被引用的旧口径「ASK 只有 1 次配额」。
 * **那些内容作为历史记录是对的，错的是判据被套在了它头上 —— 这就是假红。**
 * 假红比逃逸贵：它会训练人忽略红色。
 *
 * **但这个豁免会自己失效**：md5 对不上（= 档案被改动过）时，
 * 文件**重新进入检查范围**，并打出来要求重新说明理由。
 * 一个自己兑现不了的承诺比没有承诺更坏 —— 所以这里不写「永久豁免」，写「md5 不变才豁免」。 */
const FROZEN = [
  {
    file: 'SOUL-lessons.md',
    md5: '53f798690c39f2eeb6bebcae37caf007',
    why: '从 SOUL.md 逐字节拆出的冻结档案（原 SOUL.md 第 25–655 行）。' +
      'SOUL.md 从来不在检查范围里；并进来只会把历史引用报成缺陷。',
  },
];

function md5Of(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function buildFileSet() {
  const segs = [];
  const parts = [];
  const frozenSkipped = [];
  const frozenRevived = [];
  const add = (file, raw) => {
    const ls = String(raw).replace(/\r\n/g, '\n').split('\n');
    segs.push({ file, start: parts.length, count: ls.length });
    for (const l of ls) parts.push(l);
  };
  add(MODE, fs.readFileSync(MODE, 'utf8'));
  if (fs.existsSync(REFS)) {
    for (const f of fs.readdirSync(REFS).filter((x) => x.endsWith('.md')).sort()) {
      const p = path.join(REFS, f);
      const raw = fs.readFileSync(p, 'utf8');
      const fr = FROZEN.find((x) => x.file === f);
      if (fr) {
        const got = md5Of(raw.replace(/\r\n/g, '\n'));
        if (got === fr.md5) { frozenSkipped.push(fr); continue; }
        frozenRevived.push({ file: f, want: fr.md5, got });
      }
      add(p, raw);
    }
  }
  return { text: parts.join('\n'), segs, frozenSkipped, frozenRevived };
}

module.exports = { buildFileSet, HOME, MODE, REFS, FROZEN, md5Of };
