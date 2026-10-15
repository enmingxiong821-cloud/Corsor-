// 覆盖率报告：打印到终端 + 写入 reports/coverage-<version>.json。
//
// 主口径（M1 验收）= 严格按 moduleId 精确匹配。
// 归一化投影、补译命中作为附加信息展示，不改变主口径数字。

import fs from "node:fs";
import path from "node:path";

const pct = (n, total) => ((n / total) * 100).toFixed(2) + "%";

export function renderText({ strict, merged, packName, packCount, renameRules }) {
  const t = strict.stats.total;
  const lines = [];

  lines.push("");
  lines.push("Cursor 简中汉化 — 覆盖率报告");
  lines.push("─".repeat(48));
  lines.push(`语言包        ${packName}（同名包 ${packCount} 个）`);
  lines.push(`归一化规则    ${renameRules} 条`);
  lines.push("");
  lines.push(`键总数        ${t.toLocaleString("en-US")}`);
  lines.push(
    `已本地化      ${strict.stats.exact.toLocaleString("en-US")}  (${pct(strict.stats.exact, t)})   ← 主口径`
  );
  lines.push(
    `缺口          ${strict.stats.missing.toLocaleString("en-US")}  (${pct(strict.stats.missing, t)})`
  );
  lines.push(`缺口模块数    ${strict.missingModuleCount}`);

  if (merged) {
    const rescued = merged.rescueableByRename;
    lines.push("");
    lines.push("附加口径（不影响主口径）");
    lines.push(`  路径归一化可救回   +${rescued}  → ${pct(strict.stats.exact + rescued, t)}`);
    if (merged.stats.override > 0 || merged.stats.renamed > 0) {
      lines.push(`  补译词典命中       ${merged.stats.override}`);
      lines.push(`  归一化兜底         ${merged.stats.renamed}`);
    }
    const covered = t - merged.stats.missing;
    lines.push(`  最终覆盖           ${covered.toLocaleString("en-US")} (${pct(covered, t)})`);
    lines.push(`  最终缺口           ${merged.stats.missing.toLocaleString("en-US")}`);
  }

  lines.push("");
  return lines.join("\n");
}

// 缺口按模块排行，附英文样例
export function renderMissingTop(missing, topN = 10) {
  const byModule = new Map();
  for (const m of missing) {
    let e = byModule.get(m.moduleId);
    if (!e) byModule.set(m.moduleId, (e = []));
    e.push(m);
  }
  const ranked = [...byModule.entries()].sort((a, b) => b[1].length - a[1].length);

  const lines = ["缺口模块 Top " + Math.min(topN, ranked.length), "─".repeat(48)];
  for (const [moduleId, items] of ranked.slice(0, topN)) {
    lines.push(`${String(items.length).padStart(4)}  ${moduleId}`);
    lines.push(`      ${JSON.stringify(items[0].en).slice(0, 100)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(reportsDir, { cursorVersion, distro, strict, merged, missing }) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `coverage-${cursorVersion}.json`);
  const payload = {
    cursorVersion,
    distro,
    generatedAt: new Date().toISOString(),
    strict: strict.stats,
    missingModuleCount: strict.missingModuleCount,
    projectedWithRenames: merged
      ? {
          rescuedByRename: merged.rescueableByRename,
          covered: strict.stats.exact + merged.rescueableByRename,
        }
      : null,
    withOverrides: merged ? merged.stats : null,
    missingByModule: missing.reduce((acc, m) => {
      (acc[m.moduleId] ||= []).push({ key: m.key, en: m.en });
      return acc;
    }, {}),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}
