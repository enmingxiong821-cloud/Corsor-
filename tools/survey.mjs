// 系统性检索 GitHub 上的 Cursor 汉化相关项目。
//
// 覆盖中英文多种说法，合并去重后按相关性与热度排序。
// 运行: node tools/survey.mjs

const API = "https://api.github.com";
const H = { "User-Agent": "cursor-l10n-survey", Accept: "application/vnd.github+json" };

const QUERIES = [
  "cursor 汉化 in:name,description,readme",
  "cursor 中文汉化 in:name,description",
  "cursor 汉化补丁 in:name,description,readme",
  "cursor 中文 in:name,description,readme",
  "cursor chinese in:name,description",
  "cursor localization in:name,description",
  "cursor i18n in:name,description",
  "cursor language pack in:name,description",
  "cursor zh-cn in:name,description",
  "cursor zh-hans in:name,description",
  "topic:cursor-localization",
];

const RELEVANT = /chinese|中文|汉化|localiz|i18n|zh-cn|zh_cn|l10n|翻译/i;

const found = new Map();
const errors = [];

for (const q of QUERIES) {
  try {
    const r = await fetch(
      `${API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`,
      { headers: H }
    );
    const j = await r.json();
    if (j.message || !j.items) {
      errors.push(`${q} :: ${j.message ?? "no items"}`);
      continue;
    }
    for (const it of j.items) {
      const text = `${it.name} ${it.description ?? ""}`;
      if (!/cursor/i.test(text)) continue;
      if (!RELEVANT.test(text)) continue;
      if (found.has(it.full_name)) continue;
      found.set(it.full_name, {
        full_name: it.full_name,
        stars: it.stargazers_count,
        pushed: it.pushed_at.slice(0, 10),
        created: it.created_at.slice(0, 10),
        size: it.size,
        lang: it.language ?? "-",
        archived: it.archived,
        desc: (it.description ?? "").replace(/\s+/g, " "),
      });
    }
    console.log(`ok   ${q}  -> 累计 ${found.size}`);
  } catch (e) {
    errors.push(`${q} :: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 8000)); // 未认证搜索限流为 10 次/分钟
}

const rows = [...found.values()].sort((a, b) => b.stars - a.stars);
console.log(`\n${"=".repeat(100)}`);
console.log(`去重后相关项目: ${rows.length}`);
if (errors.length) console.log(`失败的查询:\n  ${errors.join("\n  ")}`);
console.log("=".repeat(100));

for (const r of rows) {
  console.log(
    `${r.full_name.padEnd(44)} ${String(r.stars).padStart(6)}★  ${r.pushed}  ${String(r.size).padStart(7)}KB  ${r.lang.padEnd(12)} ${r.archived ? "[ARCHIVED] " : ""}${r.desc.slice(0, 90)}`
  );
}

// 输出 JSON 便于后续整理
const fs = await import("node:fs");
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/survey.json", JSON.stringify(rows, null, 2), "utf8");
console.log(`\n已写出 build/survey.json`);
