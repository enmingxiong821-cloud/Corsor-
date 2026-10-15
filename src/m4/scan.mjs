// 扫描 Cursor 自有 bundle，找出「用户可能看得见」的字符串字面量。
//
// 关键设计：只认「字段名紧邻」的字符串。minified 代码里 UI 文案几乎都写成
//   {label:"Cursor Tab",description:"Context-aware, …"}
// 而数组元素、函数参数里的裸字符串（可能是命令 ID、日志、正则）一律放过 ——
// 漏译只是少一块中文，误伤可能让 Cursor 起不来，两者代价不对称。
//
// 曾经这里还会排除「NLS 英文表里已有的串」，理由是运行时会被语言包替换。这个前提
// 是错的：NLS 替换的是 localize() 调用点，而 Cursor Agent / Anysphere 那一层
// React 界面直接渲染 bundle 里的字面量、根本不调 localize()。实测 Settings 窗口里
// General / Appearance / Save / Back 全是这一类 —— 被排除掉就永远是英文。
// 所以不做任何 NLS 排除。

import { UI_FIELDS, NEVER_FIELDS, FIELD_RE, FIELD_WINDOW, normalizeFieldName } from "./fields.mjs";

const LIT = /"((?:[^"\\\n\r]|\\.)*)"|'((?:[^'\\\n\r]|\\.)*)'/g;

// minified 模块级常量：Sye="Start from scratch"。字符串本体在模块顶部，
// UI 位置只写 children:Sye —— 按「字段名紧邻字符串」的规则一条都抓不到，
// 这正是 Cursor Agent 窗口整片英文的主因。
const ASSIGN_RE = /([A-Za-z_$][\w$]*)\s*=\s*"((?:[^"\\\n\r]|\\.)*)"/g;
// 该标识符被当作哪个字段的值：children:Sye
const USE_RE = /([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\b/g;
// 数组元素/裸值位置：[ATe,"none","home"]。这类地方的值可能参与等值判断，翻掉会改语义。
const BARE_RE = /[\[,]\s*([A-Za-z_$][\w$]*)\s*(?=[,\]])/g;
// 但 `var Sye,n_s,i_s` 这种变量声明列表与数组元素长得一模一样，早期版本把它一并当成
// 裸值位置，于是 Sye="Start from scratch"、ATe="No Repo" 这些**只有定义处**的文案
// 全被挡在闸门外 —— Agent 窗口起手卡片整片英文就是这个原因。
const DECL_RE = /\b(?:var|let|const)\s+[\w$,\s]*$/;

// 遥测与调试标签：形容上是「自然语言」，实际永不显示给用户。
// 实测混淆主要来自 OTel/Sentry 指标描述与 WebGPU 渲染调试名，这两类字段名
// 恰好也是 label/description，只能靠内容特征排除。
const TELEMETRY = /\bin milliseconds\b|\bin bytes\b|\bper second\b|^Duration of |^Number of |^Time to |^Total (number|count|size) of /;
const DEBUG_LABEL = /^Monaco |^WebGPU |^Pixi |^Renderer /;

const UI_ALT = [...UI_FIELDS].join("|");

// 「标识型」用法：拿字段的值与字面量做等值/包含比较。那里的字面量是身份，不是文案 ——
// e.label==="Task" 的 "Task" 与 {label:"Task"} 是同一个值，翻掉显示侧判断就失配。
// 实测不挡会真的坏：o.label==="Production"?"prod":"dev" 导致 backgroundComposerEnv 存不进去、
// r.label==="Cancel" 让快选把取消项当成正常选项、e.label==="Task" 判错工具占位标题。
const CMP_LIT_RE = new RegExp(
  String.raw`(?:\.|\[(["']))(${UI_ALT})(?:\1\])?\s*(?:===|!==|==|!=|\.(?:endsWith|startsWith|includes|indexOf))\s*\(?\s*(["'])([^"'\n]{1,200})\3`,
  "g"
);
// 同样是比较，但右侧是常量：x.label===Sye。要顺着常量找回它的英文原文。
const CMP_ID_RE = new RegExp(
  String.raw`(?:\.|\[(["']))(${UI_ALT})(?:\1\])?\s*(?:===|!==|==|!=)\s*([A-Za-z_$][\w$]*)`,
  "g"
);

/**
 * 收集「被当作标识用过」的文案值。
 *
 * 判据是「同一个字段名下出现过等值比较」：比较是双向的，所以只要某字段的值参与过
 * 等值判断，该字段下所有同文字面量都按标识处理 —— 无法分辨哪一处渲染喂给了那个变量，
 * 宁可漏译也不改语义。
 *
 * @param {Map<string,string>} constIds collectUiConstants 的结果，用来解析常量比较
 * @returns {{byField:Map<string,Set<string>>, any:Set<string>}}
 *   byField 按字段名索引；any 是所有被比较过的值，供常量型命中兜底
 */
export function collectIdentityValues(source, constIds = new Map()) {
  const byField = new Map();
  const any = new Set();
  const add = (field, text) => {
    if (!text) return;
    let s = byField.get(field);
    if (!s) byField.set(field, (s = new Set()));
    s.add(text);
    any.add(text);
  };

  CMP_LIT_RE.lastIndex = 0;
  let m;
  while ((m = CMP_LIT_RE.exec(source)) !== null) add(m[2], m[4]);

  CMP_ID_RE.lastIndex = 0;
  while ((m = CMP_ID_RE.exec(source)) !== null) {
    const text = constIds.get(m[3]);
    if (text !== undefined) add(m[2], text);
  }

  return { byField, any };
}

// 字符串内容是否像「给用户看的自然语言」
export function isUiText(s) {
  if (s.length < 3 || s.length > 300) return false;
  if (!/^[\x20-\x7E]+$/.test(s)) return false; // 纯 ASCII 可打印
  if (/[{}<>\\$`]/.test(s)) return false; // 模板/HTML/转义残留
  if (/^--/.test(s)) return false; // CSS 变量
  if (/^https?:|^file:|^vscode-|^[a-z.]+@/.test(s)) return false;
  if (/^[\w.-]+\/[\w./-]+$/.test(s)) return false; // 路径
  // 无空格时只放行「首字母大写的纯英文单词」：label:"Search"、children:"Repositories"。
  // 一刀切排除会让 Settings 侧栏这类单词型标签整片漏译（Back / Agents / Models / Save）。
  if (!/\s/.test(s) && !/^[A-Z][a-z]{2,}$/.test(s)) return false;
  if (!/^[A-Z"']/.test(s)) return false; // 句子以大写开头
  if (/\d{4}-\d{2}-\d{2}T/.test(s)) return false; // ISO 时间戳
  if (/^[A-Z_]+$/.test(s)) return false; // 全大写常量风格
  if (TELEMETRY.test(s)) return false;
  if (DEBUG_LABEL.test(s)) return false;
  return true;
}

/**
 * 找出「值本身是界面文案、但被抽成模块级常量」的那些标识符。
 *
 * 三重闸门，缺一不可：
 *   1. 至少在一个 UI_FIELDS 字段里被当值用过（否则无从判定它是界面文案）
 *   2. 从没在 NEVER_FIELDS 字段里出现过（否则同一个常量还兼作数据标识）
 *   3. 没出现在数组/裸值位置（那种位置上的值可能参与等值判断，翻掉会改运行时语义）
 *
 * @returns {Map<string,string>} 标识符 → 英文原文
 */
export function collectUiConstants(source) {
  const texts = new Map();
  ASSIGN_RE.lastIndex = 0;
  let m;
  while ((m = ASSIGN_RE.exec(source)) !== null) {
    const [, id, text] = m;
    if (texts.has(id)) continue;
    if (!isUiText(text)) continue;
    texts.set(id, text);
  }
  if (texts.size === 0) return new Map();

  const fields = new Map();
  USE_RE.lastIndex = 0;
  while ((m = USE_RE.exec(source)) !== null) {
    const [, field, id] = m;
    if (!texts.has(id)) continue;
    if (!fields.has(id)) fields.set(id, new Set());
    fields.get(id).add(field);
  }

  const bare = new Set();
  BARE_RE.lastIndex = 0;
  while ((m = BARE_RE.exec(source)) !== null) {
    if (!texts.has(m[1])) continue;
    // 变量声明列表不是数组元素，别当成「参与等值判断」的证据
    if (DECL_RE.test(source.slice(Math.max(0, m.index - 80), m.index))) continue;
    bare.add(m[1]);
  }

  const ok = new Map();
  for (const [id, text] of texts) {
    const f = fields.get(id);
    if (!f || f.size === 0) continue;
    if ([...f].some((x) => NEVER_FIELDS.has(x))) continue;
    if (![...f].some((x) => UI_FIELDS.has(x))) continue;
    if (bare.has(id)) continue;
    ok.set(id, text);
  }
  return ok;
}

// ── 形状规则 ─────────────────────────────────────────────────────────────────
//
// 「字段名紧邻字符串」之外，实测还有三类承载界面文案的写法，只按字段名一条都抓不到。
// 三条规则都限定在精确形状上：放宽成「字段名不在 NEVER 里就翻」会命中 HTTP 头
// （X-Forwarded / Forwarded-For）、键盘枚举（t[t.Tab=9]="Tab"）、查表键
// （{original:"Debug",value:D(2106)}），实测确认会改坏运行时语义，故不采用。

// ① 本地化字符串对象：title:{value:"New Chat",original:"New Chat"} —— 命令/菜单标题。
//    只翻 value，且要求两个串完全相同（不同说明这不是那份成对结构），original 一律不动。
const TITLE_OBJ_RE = /title:\{\s*value:\s*(["'])((?:\\.|(?!\1)[^\\\n\r])*)\1\s*,\s*original:\s*\1\2\1\s*\}/g;

// ② 导航映射表：TNn={general:"General",appearance:"Appearance",browser:"Browser & Network",…}
//    键是内部 id、值是显示文案 —— 设置页整列左导航就是这么来的。两个限定缺一不可：
//      · 键必须是「全小写 id 风格」，把 name/type/mode/status 这些遥测键（都在 NEVER_FIELDS 里）排掉
//      · 整块至少 5 个成员，把 {message:"…",error:"…"} 这种两三个成员的错误载荷排掉
const NAV_MEMBER = String.raw`\s*(?:"[a-z][a-z0-9-]*"|[a-z][a-z0-9-]*)\s*:\s*(?:"(?:\\.|[^"\\\n\r])*"|'(?:\\.|[^'\\\n\r])*')`;
const NAV_MAP_RE = new RegExp(String.raw`\{${NAV_MEMBER},(?:${NAV_MEMBER},){3,}${NAV_MEMBER}\s*\}`, "g");
const NAV_ENTRY_RE = new RegExp(
  String.raw`(?:"([a-z][a-z0-9-]*)"|([a-z][a-z0-9-]*))\s*:\s*(["'])((?:\\.|(?!\3)[^\\\n\r])*)\3`,
  "g"
);

// ③ 兜底与三元分支：e.getComposerTitle(t)||"New Chat"、xa?"This PC":"This Mac"
//    这些串没有字段名可依，但确实是渲染出去的默认文案。
//    三元必须两个分支一起收 —— 只翻 ? 后面那个会得到「一半中文一半英文」，
//    比整条不翻更难看；两个分支都是字面量才认（`x?"A":y` 不动）。
const FALLBACK_RE = /(?:\|\||\?\?)\s*(["'])((?:\\.|(?!\1)[^\\\n\r])*)\1/g;
const TERNARY_RE = /\?(?!\.|\?)\s*(["'])((?:\\.|(?!\1)[^\\\n\r])*)\1\s*:\s*(["'])((?:\\.|(?!\3)[^\\\n\r])*)\3/g;

// 匹配串在 m[0] 里的起始下标。TITLE_OBJ 里同一段文本出现两次，取首个即 value 那一处。
function litStart(m, quote, content) {
  return m.index + m[0].indexOf(quote + content + quote);
}

// 同上，但从 m[0] 的第 from 个字符往后找 —— 三元两个分支的文案可能完全相同
// （x?"Home":"Home"），从第一个结束处往后找才不会两次算到同一处位置。
function litStartFrom(m, quote, content, from) {
  const rel = m[0].indexOf(quote + content + quote, from);
  return m.index + (rel < 0 ? m[0].indexOf(quote + content + quote) : rel);
}

function litEnd(start, quote, content) {
  return start + quote.length + content.length + quote.length;
}

export function collectShapeHits(source, { identity, cmpAny } = {}) {
  const out = [];
  const cmp = identity?.any ?? new Set();
  const anyCmp = cmpAny ?? new Set();
  const emit = (start, quote, raw, field) => {
    if (!isUiText(raw)) return;
    // 兜底/三元没有字段名可依，只能按值挡，而且要比字段那层挡得更宽：
    // 只要该值在**任何地方**参与过等值比较或 case 分支，就按标识处理。
    // 实测这道闸拦下 Enter / Delete / True / False / Auto / Off / Disabled 这一类
    // 既是文案又是键名/枚举的值 —— 显示侧翻了、判断侧没翻，行为就变了。
    if (field === null) {
      if (cmp.has(raw) || anyCmp.has(raw)) return;
    } else if (identity?.byField.get(field)?.has(raw)) return;
    out.push({ start, end: start + quote.length + raw.length + quote.length, quote, raw, field });
  };

  // 用 matchAll 而不是 exec 循环：非全局正则的 exec 恒返回同一个匹配、lastIndex 永不推进，
  // 写成 while(exec) 就是死循环 —— 实测在 47 MB bundle 上把 4 GB 堆直接打爆。
  // matchAll 遇到非全局正则抛 TypeError，这类错误只会当场报出来，不会变成静默打转。
  const each = (re, cb) => {
    for (const m of source.matchAll(re)) cb(m);
  };

  each(TITLE_OBJ_RE, (m) => emit(litStart(m, m[1], m[2]), m[1], m[2], "title"));
  each(FALLBACK_RE, (m) => emit(m.index + m[0].indexOf(m[1]), m[1], m[2], null));
  each(TERNARY_RE, (m) => {
    // 两个分支都要像文案才认。只翻 ? 后面那个会得到「一半中文一半英文」；而
    // e?"Top":"InlineStart" 这种取值三元（CSS 方向、枚举名）翻了会让布局错位 ——
    // 它恰好只有一个分支像文案，用「两边都像」正好把它排除。
    if (!isUiText(m[2]) || !isUiText(m[4])) return;
    const first = litStart(m, m[1], m[2]);
    emit(first, m[1], m[2], null);
    emit(litStartFrom(m, m[3], m[4], litEnd(first, m[1], m[2]) - m.index), m[3], m[4], null);
  });

  // 映射表要先框出整块，再逐条取值 —— 正则的重复组只保留最后一次捕获，分两步才拿得到每一条。
  each(NAV_MAP_RE, (map) => {
    const span = map[0];
    NAV_ENTRY_RE.lastIndex = 0;
    let e;
    while ((e = NAV_ENTRY_RE.exec(span)) !== null) {
      const field = e[1] ?? e[2];
      if (NEVER_FIELDS.has(field)) continue;
      // 位置从条目末尾回推。不能用 indexOf(e[3]) —— 键也带引号时
      // （{"aria-label":"Pinned"}）第一个引号就是键的开引号，位置会落到键上，
      // 改写时把 "aria-la 截断，语法直接崩。条目恰好以值的收引号结束，回推恒精确。
      emit(map.index + e.index + e[0].length - (e[3] + e[4] + e[3]).length, e[3], e[4], field);
    }
  });

  return out;
}

// 兜底/三元那层守卫要判「这个字面量在某处被当成标识比较过」。判定直接挂在已有的
// 字面量遍历上（看紧邻前后文），不再为它单独扫一遍 47 MB。
const CMP_LEFT_RE = /(?:===|!==|==|!=)\s*$/; // "X"===… —— 该串在比较左侧
const CMP_RIGHT_RE = /^\s*(?:===|!==|==|!=)/; // …==="X" —— 该串在比较右侧
const CASE_LEFT_RE = /\bcase\s*$/; // case "X": —— 前面可能是 { ，不能用「空白或行首」限定

/**
 * @param {string} source bundle 源码
 * @param {{nlsExclude?: Set<string>}} [opts]
 *   nlsExclude：NLS 英文表里的串集合。只对**被校验的内核 bundle** 传 ——
 *   那层的字面量是 localize() 的默认值，表内有键就是死文本，翻它不起作用。
 *   详见 targets.mjs 头部的规则对照。
 * @returns {Array<{start,end,quote,raw,field,context}>} 按 start 升序
 */
export function scanBundle(source, { nlsExclude } = {}) {
  const constIds = collectUiConstants(source);
  const identity = collectIdentityValues(source, constIds);
  const hits = [];
  const seen = new Set();
  const cmpAny = new Set();

  const take = (start, end, quote, raw, field) => {
    if (seen.has(start)) return; // 同一个字面量可能同时被字段规则和形状规则命中
    seen.add(start);
    hits.push({
      start,
      end,
      quote,
      raw,
      field,
      context: source.slice(Math.max(0, start - 110), end + 50),
    });
  };

  LIT.lastIndex = 0;
  let m;
  while ((m = LIT.exec(source)) !== null) {
    const raw = m[1] ?? m[2];

    // 先记「这个串参与了等值比较」—— 必须在下面那些 continue 之前，
    // 因为被比较的串往往正是会被 isUiText 挡掉的那类（Auto / dark / utf8）。
    const end = m.index + m[0].length;
    const lead = source.slice(Math.max(0, m.index - FIELD_WINDOW), m.index);
    if (
      CMP_LEFT_RE.test(lead) ||
      CMP_RIGHT_RE.test(source.slice(end, end + 8)) ||
      (CASE_LEFT_RE.test(lead) && /^\s*:/.test(source.slice(end, end + 4)))
    ) {
      cmpAny.add(raw);
    }

    if (!isUiText(raw)) continue;
    if (nlsExclude && nlsExclude.has(raw)) continue;

    const fm = lead.match(FIELD_RE);
    if (!fm) continue;
    const field = normalizeFieldName(fm[1] ?? fm[2] ?? fm[3]);
    // 字段名是 minified 常量名时，白名单形同虚设 —— 由 collectUiConstants 的
    // 用法闸门代它把关，通过的才认。
    if (!constIds.has(field) && (NEVER_FIELDS.has(field) || !UI_FIELDS.has(field))) continue;
    // 标识值守卫：该值在本字段下参与过等值比较（或该常量兼作比较对象），
    // 翻掉会让运行时判断与显示失配 —— 这是唯一会真正改语义的一类，必须挡。
    if (identity.byField.get(field)?.has(raw)) continue;
    if (constIds.has(field) && identity.any.has(raw)) continue;

    take(m.index, end, m[1] !== undefined ? '"' : "'", raw, field);
  }

  for (const h of collectShapeHits(source, { identity, cmpAny })) {
    if (nlsExclude && nlsExclude.has(h.raw)) continue;
    take(h.start, h.end, h.quote, h.raw, h.field);
  }

  hits.sort((a, b) => a.start - b.start);
  return hits;
}
