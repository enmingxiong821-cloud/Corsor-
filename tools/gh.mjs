// 轻量 GitHub 检索工具（走 Node 直连，本机已验证可通）。
//
//   node tools/gh.mjs search "<query>" [n]     搜索仓库，输出精简列表
//   node tools/gh.mjs tree <owner/repo> [ref]  列出仓库文件树
//   node tools/gh.mjs file <owner/repo> <path> [ref]
//   node tools/gh.mjs readme <owner/repo>
//
// 若设置了 GITHUB_TOKEN 环境变量则自动带上（提高速率上限）。

const API = "https://api.github.com";

function headers() {
  const h = {
    "User-Agent": "cursor-l10n-research",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function api(url, raw = false) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} :: ${body.slice(0, 300)}`);
  }
  return raw ? res.text() : res.json();
}

const [cmd, ...rest] = process.argv.slice(2);

try {
  if (cmd === "search") {
    const q = rest[0];
    const n = Number(rest[1] ?? 15);
    const r = await api(
      `${API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${n}`
    );
    console.log(`total=${r.total_count}`);
    for (const it of r.items) {
      const desc = (it.description ?? "").replace(/\s+/g, " ").slice(0, 118);
      console.log(
        `${it.full_name.padEnd(46)} ${String(it.stargazers_count).padStart(7)}  ${it.pushed_at.slice(0, 10)}  ${desc}`
      );
    }
  } else if (cmd === "tree") {
    const [repo, ref] = rest;
    const info = await api(`${API}/repos/${repo}`);
    const branch = ref ?? info.default_branch;
    const t = await api(`${API}/repos/${repo}/git/trees/${branch}?recursive=1`);
    console.log(`# ${repo}@${branch}  truncated=${t.truncated}  files=${t.tree.length}`);
    for (const e of t.tree) {
      if (e.type === "blob") console.log(`${String(e.size).padStart(9)}  ${e.path}`);
    }
  } else if (cmd === "file") {
    const [repo, p, ref] = rest;
    const q = ref ? `?ref=${ref}` : "";
    const enc = p.split("/").map(encodeURIComponent).join("/");
    const txt = await api(`${API}/repos/${repo}/contents/${enc}${q}`, true);
    console.log(txt);
  } else if (cmd === "readme") {
    const [repo] = rest;
    const txt = await api(`${API}/repos/${repo}/readme`, true);
    console.log(txt);
  } else {
    console.log("usage: search|tree|file|readme");
    process.exit(2);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
