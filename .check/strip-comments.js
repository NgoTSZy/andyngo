'use strict';
/* strip-comments.js —— **剥注释**的唯一实现（一份口径两处用）
 *
 * ── 为什么单独一个文件 ───────────────────────────────────────────────────
 * 这个函数原本是 `probe-crossref.js` 的局部函数（X1 用它排除「注释里的 `exit 2`」）。
 * **ISS-138** 发现 `tests/ruler-callpoint.js` 的 R1 犯了**同一个错**：
 * 它把「**注释里提到**」也算作「可执行调用点」——
 * ISS-135 当时只排除了 `.md`，而 **`.js` / `.sh` 的注释同样不是执行**。
 *
 * **复制一份会静默分叉**（本仓库老账：`fileset.js` 文件头记的实测代价）——
 * 所以这里抽成共享模块，两个判据 `require` 同一份。
 * 先例：`newid.js` 的 `flattenBody()` 抽出来给 `alloc.sh` 复用（ISS-125）。
 *
 * ── 边界（**故意**不做的部分，理由写在这里）────────────────────────────
 * **不剥字符串字面量**。看起来「字符串里提到文件名也不算执行」很对，
 * 但反例是真实存在的：`bash -c "node .check/tests/x.js"` —— 名字在**字符串**里，
 * 而它**确实是**一次执行。剥字符串会把它判成「没接」= **假红**，
 * 而假红比逃漏贵得多（它会训练人忽略红色）。**所以这里只剥注释。**
 * 残余风险（如实记）：`echo ".check/tests/x.sh"` 这种「字符串里的假调用点」仍会被算上。
 *
 * 用法：`const { stripComments } = require('<..>/strip-comments.js');`
 */
/* 剥掉块注释与行注释（含 shell 的 `#`）。判的是**代码**，不是文档。 */
function stripComments(src, isSh) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/^[ \t]*\/\/.*$/gm, ' ');
  s = s.replace(/^[ \t]*\*.*$/gm, ' ');
  if (isSh) s = s.replace(/^[ \t]*#.*$/gm, ' ');
  return s;
}

module.exports = { stripComments };
