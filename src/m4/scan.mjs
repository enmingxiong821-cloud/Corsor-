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

// 「字段名紧邻字符串」这条规则的第二条通道：直接在原文上匹配，不经过字符串 token 切分。
//
// 起因见 scanBundle 里的说明：LIT 只认引号配对，而模板字符串里的引号（`` `'{snip} ${n}` ``、
// `https://` 那类）会让配对**整体翻转**，此后一大段区间里的真实字符串被当成「串间代码」，
// 这条规则整片看不见。实测 Agent 窗口菜单标题 `title:"New Browser"` 就是这么漏的。
// 五条形状规则与两张辅助表本来就是正则直接跑原文，不受配对影响；这条通道把字段规则拉齐。
//
// 写法与 FIELD_RE 等价（字段名 + `:`/`=` + 一个格式完整的字面量），只是不依赖前后文窗口。
const DIRECT_FIELD_RE = new RegExp(
  String.raw`(?:"([A-Za-z][\w-]*)"|'([A-Za-z][\w-]*)'|([A-Za-z_$][\w$]*))\s*[:=]\s*(["'])((?:\\.|(?!\4)[^\\\n\r])*)\4`,
  "g"
);

// 本地化壳的**对象形态**：`D({key:"glassOsEditUndo",comment:["&& denotes a mnemonic"]},"&&Undo")`。
//
// 上游写的是 `localize({key, comment}, msg)`，打包后壳函数退化成
// `D(t,e){ return typeof t=="number" ? 表[t] : e }` —— **键不是数字就恒返回英文实参**，
// 表里查不到也照样返回 `e`。所以这条路的译文只能落在那一个字面量上：数字键那批由语言包
// 走 NLS 通道，对象键这批语言包根本碰不到（键不在 NLS 键表里）。
//
// 字段规则够不着它（值前面是 `D(` 而不是字段名），形状规则原来也没有这条形状 ——
// 实测整个编辑菜单（撤销/重做/剪切/复制/粘贴/全选）加「重新加载窗口」就这么整条漏掉。
//
// `comment:` 是**必需项**，不能省：省了就变成「`{key:"…"}, "文案"`」这个宽形状，
// 会把 React 的 `createElement("strong",{key:"strong"},"What this demonstrates:")` 大片算进来
// （实测 glass 里多出 5 条开发文档面板的文案）。
const SHIM_LOCALIZE_RE = new RegExp(
  String.raw`\{key:"([^"]+)"\s*,\s*comment:\[[^\]]*\]\}\s*,\s*(["'])((?:\\.|(?!\2)[^\\\n\r])*)\2`,
  "g"
);

// 三元**链**：`cond ? "A" : other ? "B" : "C"`。
//
// TERNARY_RE 只认「两支都是字面量」，上面这条的 else 支是另一条三元、不是字面量，
// 于是外层那一支整条漏掉。实测 `xa?"This PC":_r?"This Mac":"This Computer"` 里
// 只有 This PC 没翻，同一个函数渲染出来「This PC / 此 Mac / 此计算机」三不像。
//
// 中间那段限定成「简单标识符或成员访问」，不认带括号的调用 —— 宁可少收几个，
// 也不要让 `f()?…` 这种形状把两边含义不同的串配到一起。只补**外层**那一支；
// 内层两支 TERNARY_RE 已经收过，按起始偏移去重后不会重复计。
const TERNARY_CHAIN_RE = new RegExp(
  String.raw`\?(?!\.|\?)\s*(["'])((?:\\.|(?!\1)[^\\\n\r])*)\1\s*:\s*[A-Za-z_$][\w$.]*\s*\?\s*(["'])((?:\\.|(?!\3)[^\\\n\r])*)\3\s*:\s*(["'])((?:\\.|(?!\5)[^\\\n\r])*)\5`,
  "g"
);

// 三元**深链**：`cond ? "A" : expr ? "B" : expr ? "C" : "D"` —— 中间那段的 else 支
// 不是裸标识符（带 `===` 比较、`&&`、成员访问），TERNARY_CHAIN_RE 的「简单标识符」
// 那道限定够不着，于是整条链最外层那一支漏译（实测 41 条去重：Agent 窗口的
// Move to this machine / Login / Unstage All / 工作区失联三连都在这里）。
//
// 判定分两层：① `?` 后那一支自己得像文案（emit 内的 isUiText）；② 用**不消耗字符的
// 先行断言**确认它后面真跟着一条由「含等值比较的表达式 ? "文案" : 」串成的链。
// 断言必须写成 lookahead：按普通匹配跑，一条 matchAll 会在链上交替命中 —— 命中一处
// 就吃掉后面一段，剩下的分支永远轮不到自己那次匹配（实测会漏掉 Login、Limit Reached，
// 集合从 41 掉到 29）。
// 断言里要求中间段**含等值比较符**是必要条件：`expr ? "A" : "B"` 这类普通三元的中间段
// 已有 TERNARY_RE 收，这里不重复；带上比较符才说明读到的是状态分支链，不会把
// `f(x) ? "a" : g(y) ? "b" : "c"` 这种含义互不相干的串配到一起。
const SW_MID = String.raw`(?:[^,;?:()\n\r=]{1,40}(?:===|!==|==|!=)){1,2}[^,;?:()\n\r=]{0,40}`;
const SW_CHAIN = String.raw`(?:${SW_MID}\s*\?\s*["'][^"'\n\r]{0,300}["']\s*:\s*){1,8}["'][^"'\n\r]{0,300}["']`;
const TERNARY_DEEP_CHAIN_RE = new RegExp(
  String.raw`\?(?!\.|\?)\s*(["'])((?:\\.|(?!\1)[^\\\n\r])*)\1\s*:\s*(?=${SW_CHAIN})`,
  "g"
);

// ⑨ 裸常量白名单：`var Eee="No Repository",fKr="Start from scratch";` —— 模块级常量赋值，
//    没有字段名可依、也不是三元或兜底，前面八条规则一条都够不着。
//
//    为什么不写一条通用的「裸常量 / 裸 return」规则：实测会把 SVG 的 `d` 路径、zod 错误表、
//    Java toString 格式整片收进来（见 docs/05 §7），代价不对称。所以改成逐个值开口子，
//    名单挂在**目标**上（targets.mjs 的 bareConstAllow），且每个值都要先确认是纯渲染标签。
//
//    匹配只锚「=值」这半边，不锚标识符：minified 名在同一个 bundle 里会被不同模块复用，
//    锚标识符等于给自己埋雷；值在目标内唯一，够精确了。
//
//    ★ 名单必须按目标限定。同一个英文串在不同 bundle 里可能身份不同 ——
//      `Start from scratch` 在 anysphere 是纯标签，在 glass（`Sye`）与内核（`_Yb`）里
//      却是「标签兼哨兵」。全局值白名单会把不该翻的一起翻掉。
const BARE_CONST_HEAD = String.raw`(?<![A-Za-z0-9_$])[A-Za-z_$][\w$]*\s*=\s*`;
function bareConstRe(value) {
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${BARE_CONST_HEAD}(["'])(${esc})\\1`, "g");
}

// 菜单助记符（`&&U` 那种）会让 isUiText 的首字母闸失守：`&&Undo`、`Cu&&t` 都不以大写开头。
// 把 `&&` 全剥掉再验一次即可 —— 只放宽「首字母」这一条，其余判定照旧。
const isMnemonicText = (s) => isUiText(s) || isUiText(s.replace(/&&/g, ""));

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
// 「字段名紧邻字符串」之外，实测还有五类承载界面文案的写法，只按字段名一条都抓不到。
// 五条规则都限定在精确形状上：放宽成「字段名不在 NEVER 里就翻」会命中 HTTP 头
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

// ⑤ 驼峰键映射表：zme={section:"Browser",automation:"Browser Automation",protectionDescription:"…"}。
//    形状与 ② 相同，只是键是驼峰 —— ② 的「全小写」限定抓不到，独立 Agent 设置面板的
//    Browser 那一组就是这么整片漏掉的。
//
//    ② 用「全小写」是拿它当廉价代理，本意是排掉 name/type/mode/status 这类遥测键；
//    而那批键名本来就都在 NEVER_FIELDS 里，所以这里改成显式判定：**任一键归一后落进
//    NEVER_FIELDS 就整块丢弃**。实测这一步挡掉三张会改坏运行时的表 —— Statsig 字段映射
//    （{EventCount:"ec",SdkKey:"k",…}）、权限 scope（{ReadSpend:"team.spend.read",…}）、
//    枚举 slug（{SOFTWARE_ENGINEER:"software-engineer",…}）—— 若不挡，值会被翻成中文写回，
//    直接改运行时语义。再加一道「每个值都必须通过 isUiText」挡掉 {invalid_type:"invalid_type"}
//    这类标识表。逐条仍走 ② 那套标识值守卫（emit 里按字段名判）。
const CAMEL_MEMBER = String.raw`\s*(?:"([A-Za-z_$][A-Za-z0-9_$-]*)"|([A-Za-z_$][A-Za-z0-9_$-]*))\s*:\s*(["'])((?:\\.|(?!\3)[^\\\n\r])*)\3`;
const CAMEL_MAP_RE = new RegExp(String.raw`\{${CAMEL_MEMBER}(?:,${CAMEL_MEMBER}){4,}\s*\}`, "g");
const CAMEL_ENTRY_RE = new RegExp(CAMEL_MEMBER, "g");

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

export function collectShapeHits(source, { identity, cmpAny, bareConstAllow } = {}) {
  const out = [];
  const cmp = identity?.any ?? new Set();
  const anyCmp = cmpAny ?? new Set();
  const bareConstRes = (bareConstAllow ?? []).map((v) => bareConstRe(v));
  const emit = (start, quote, raw, field, accept = isUiText) => {
    if (!accept(raw)) return;
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

  // ⑥ 三元链的外层分支（形状与理由见 TERNARY_CHAIN_RE 上方的注释）。
  //    三分支都要像文案才认 —— 与 TERNARY_RE 同一条尺度：只翻外层会让这条三元
  //    变成一半中文一半英文，比整条不翻更难看。中间那个表达式不求值，只是位置上的一环。
  each(TERNARY_CHAIN_RE, (m) => {
    if (!isUiText(m[2]) || !isUiText(m[4]) || !isUiText(m[6])) return;
    emit(litStart(m, m[1], m[2]), m[1], m[2], null);
  });

  // ⑦ 本地化壳的对象形态（形状与理由见 SHIM_LOCALIZE_RE 上方的注释）。
  //    没有字段名可依，故 field 传 null，走「按值挡、比字段那层更宽」的标识守卫。
  //    助记符串过不了 isUiText 的首字母闸，用 isMnemonicText 验（只放宽这一条）。
  each(SHIM_LOCALIZE_RE, (m) => {
    const start = m.index + m[0].length - (m[2] + m[3] + m[2]).length;
    emit(start, m[2], m[3], null, isMnemonicText);
  });

  // ⑧ 深链的每个分支（形状与理由见 TERNARY_DEEP_CHAIN_RE 上方的注释）。
  //    断言不消耗字符，所以链上每一环都会各自命中一次，不必像 ⑥ 那样只补最外层一支。
  each(TERNARY_DEEP_CHAIN_RE, (m) => {
    emit(litStart(m, m[1], m[2]), m[1], m[2], null);
  });

  // ⑨ 裸常量白名单，形状与理由见 BARE_CONST_RE 那一段。field 传 null —— 没有字段名可依，
  //    只能走「按值挡、比字段那层更宽」的标识守卫；这道守卫同时也是最后一道保险：
  //    哪天真有代码拿它做等值比较，cmpAny 会自动把这条拦下。
  for (const re of bareConstRes) {
    each(re, (m) => {
      emit(m.index + m[0].length - (m[1] + m[2] + m[1]).length, m[1], m[2], null);
    });
  }

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

  // ⑤ 见上：键是驼峰的那批映射表。整块的两道闸（键不进 NEVER、值全是界面文案）先判，
  // 过了再逐条 emit —— emit 里那道标识值守卫仍然生效。
  //
  // 比 ② 多一道按值的闸：② 只按「该表键」查 byField，而 x==="Browser Automation" 这种
  // 裸比较记不到表键名下，于是表值翻了、判断侧没翻。这里对每个值再查一次全局比较集
  // （cmpAny，此时已由主遍历填满），代价是多挡几个值，换来的是不会改语义。
  each(CAMEL_MAP_RE, (map) => {
    const span = map[0];
    CAMEL_ENTRY_RE.lastIndex = 0;
    const entries = [...span.matchAll(CAMEL_ENTRY_RE)];
    if (entries.length < 5) return;
    if (entries.some((e) => NEVER_FIELDS.has(normalizeFieldName(e[1] ?? e[2])))) return;
    if (!entries.every((e) => isUiText(e[4]))) return;
    for (const e of entries) {
      if (anyCmp.has(e[4])) continue;
      emit(map.index + e.index + e[0].length - (e[3] + e[4] + e[3]).length, e[3], e[4], e[1] ?? e[2]);
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
 * @param {{nlsExclude?: Set<string>, bareConstAllow?: string[]}} [opts]
 *   nlsExclude：NLS 英文表里的串集合。只对**被校验的内核 bundle** 传 ——
 *   那层的字面量是 localize() 的默认值，表内有键就是死文本，翻它不起作用。
 *   详见 targets.mjs 头部的规则对照。
 *   bareConstAllow：规则 ⑨ 的裸常量值白名单（`var X="…"` 形态，没有字段可依），
 *   只登记逐个确认过是纯渲染标签的值，且**按目标下发** —— 同一个串换个 bundle
 *   可能兼作哨兵。见 targets.mjs 的 anysphere 目标。
 * @returns {Array<{start,end,quote,raw,field,context}>} 按 start 升序
 */
export function scanBundle(source, { nlsExclude, bareConstAllow } = {}) {
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

  // 上面那轮走 LIT 切分；模板字符串里的引号会让它的配对整体翻转，翻转区间里的真字符串
  // 被当成「串间代码」，字段规则整片失效。这里用一条不依赖配对的同规则正则补回来 ——
  // 两轮按起始偏移去重（take 里的 seen），所以只会净增、不会覆盖上面那轮的结果。
  for (const m of source.matchAll(DIRECT_FIELD_RE)) {
    const quote = m[4];
    const raw = m[5];
    if (!isUiText(raw)) continue;
    if (nlsExclude && nlsExclude.has(raw)) continue;
    const field = normalizeFieldName(m[1] ?? m[2] ?? m[3]);
    if (!constIds.has(field) && (NEVER_FIELDS.has(field) || !UI_FIELDS.has(field))) continue;
    if (identity.byField.get(field)?.has(raw)) continue;
    if (constIds.has(field) && identity.any.has(raw)) continue;
    // 替换区间从匹配末尾回推，与映射表那条同理：正则整体以值的收引号结尾，回推恒精确。
    const start = m.index + m[0].length - (quote + raw + quote).length;
    take(start, start + quote.length + raw.length + quote.length, quote, raw, field);
  }

  for (const h of collectShapeHits(source, { identity, cmpAny, bareConstAllow })) {
    if (nlsExclude && nlsExclude.has(h.raw)) continue;
    take(h.start, h.end, h.quote, h.raw, h.field);
  }

  hits.sort((a, b) => a.start - b.start);
  return hits;
}
