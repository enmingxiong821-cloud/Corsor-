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

import { UI_FIELDS, NEVER_FIELDS, FIELD_RE, FIELD_WINDOW } from "./fields.mjs";

const LIT = /"((?:[^"\\\n\r]|\\.)*)"|'((?:[^'\\\n\r]|\\.)*)'/g;

// minified 模块级常量：Sye="Start from scratch"。字符串本体在模块顶部，
// UI 位置只写 children:Sye —— 按「字段名紧邻字符串」的规则一条都抓不到，
// 这正是 Cursor Agent 窗口整片英文的主因。
const ASSIGN_RE = /([A-Za-z_$][\w$]*)\s*=\s*"((?:[^"\\\n\r]|\\.)*)"/g;
// 该标识符被当作哪个字段的值：children:Sye
const USE_RE = /([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\b/g;
// 数组元素/裸值位置：[ATe,"none","home"]。这类地方的值可能参与等值判断，翻掉会改语义。
const BARE_RE = /[\[,]\s*([A-Za-z_$][\w$]*)\s*(?=[,\]])/g;

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
    if (texts.has(m[1])) bare.add(m[1]);
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
  LIT.lastIndex = 0;
  let m;
  while ((m = LIT.exec(source)) !== null) {
    const raw = m[1] ?? m[2];
    if (!isUiText(raw)) continue;
    if (nlsExclude && nlsExclude.has(raw)) continue;

    const before = source.slice(Math.max(0, m.index - FIELD_WINDOW), m.index);
    const field = before.match(FIELD_RE)?.[1];
    if (!field) continue;
    // 字段名是 minified 常量名时，白名单形同虚设 —— 由 collectUiConstants 的
    // 用法闸门代它把关，通过的才认。
    if (!constIds.has(field) && (NEVER_FIELDS.has(field) || !UI_FIELDS.has(field))) continue;
    // 标识值守卫：该值在本字段下参与过等值比较（或该常量兼作比较对象），
    // 翻掉会让运行时判断与显示失配 —— 这是唯一会真正改语义的一类，必须挡。
    if (identity.byField.get(field)?.has(raw)) continue;
    if (constIds.has(field) && identity.any.has(raw)) continue;

    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      quote: m[1] !== undefined ? '"' : "'",
      raw,
      field,
      context: source.slice(Math.max(0, m.index - 110), m.index + m[0].length + 50),
    });
  }
  return hits;
}
