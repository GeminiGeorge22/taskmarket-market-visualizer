const $ = (s, el = document) => el.querySelector(s);
const root = $("#root");
const board = $("#board");
const form = $("#filters");
const DEFAULTS = {
  sort: "opportunity",
  range: "30d",
  chain: "both",
  minReward: "",
  maxSubs: "",
  free: "",
  category: "",
  ending: "",
};
let state = { ...DEFAULTS, data: null };

function fmt(n, d = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function usd(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1000) return fmt(n, 0);
  if (n >= 10) return fmt(n, 1);
  return fmt(n, 2);
}
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + " ET";
}
function timeLeft(iso, now = Date.now()) {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "ended";
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 24) {
    const hours = Math.floor(h);
    const mins = Math.round((h - hours) * 60);
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(h / 24);
  const hours = Math.round(h - days * 24);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}
function endingMs(token) {
  if (token === "24h") return 24 * 3600000;
  if (token === "48h") return 48 * 3600000;
  if (token === "7d") return 7 * 24 * 3600000;
  return null;
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const next = { ...DEFAULTS };
  const sort = p.get("sort");
  if (["opportunity", "reward", "competition", "ending"].includes(sort)) next.sort = sort;
  const range = p.get("range");
  if (["7d", "30d", "90d", "all"].includes(range)) next.range = range;
  const chain = p.get("chain");
  if (["both", "4217", "8453"].includes(chain)) next.chain = chain;
  if (p.has("minReward") && p.get("minReward") !== "") next.minReward = p.get("minReward");
  if (p.has("maxSubs") && p.get("maxSubs") !== "") next.maxSubs = p.get("maxSubs");
  if (p.get("free") === "1") next.free = "1";
  if (p.get("category")) next.category = p.get("category");
  if (["24h", "48h", "7d"].includes(p.get("ending"))) next.ending = p.get("ending");
  return next;
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = state[k];
    if (v != null && String(v) !== "" && String(v) !== def) p.set(k, String(v));
  }
  const qs = p.toString();
  const next = qs ? `?${qs}` : location.pathname;
  if (next !== location.pathname + location.search) history.replaceState(null, "", next);
}

function syncForm() {
  if (!form) return;
  form.minReward.value = state.minReward;
  form.maxSubs.value = state.maxSubs;
  form.ending.value = state.ending;
  form.category.value = state.category;
  form.chain.value = state.chain;
  form.sort.value = state.sort;
  form.free.checked = state.free === "1";
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.range === state.range ? "true" : "false"));
}

function formToState() {
  if (!form) return;
  state.minReward = form.minReward.value.trim();
  state.maxSubs = form.maxSubs.value.trim();
  state.ending = form.ending.value;
  state.category = form.category.value;
  state.chain = form.chain.value;
  state.sort = form.sort.value;
  state.free = form.free.checked ? "1" : "";
}

function selectedChains(data) {
  const ids = state.chain === "both" ? Object.keys(data.chains) : [state.chain];
  return ids.map((id) => data.chains[id]).filter(Boolean);
}

function allOpenTasks(data) {
  if (Array.isArray(data.openPaidTasks) && data.openPaidTasks.length) return data.openPaidTasks;
  return Object.values(data.chains || {}).flatMap((c) => c.openPaidTasks || []);
}

function fillCategories(tasks) {
  const sel = form?.category;
  if (!sel) return;
  const current = state.category;
  const modes = [...new Set(tasks.map((t) => t.mode).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">All categories</option>` + modes.map((m) => `<option value="${m}">${m}</option>`).join("");
  if (current && modes.includes(current)) sel.value = current;
  else if (current && !modes.includes(current)) {
    state.category = "";
    sel.value = "";
  }
}

function filteredTasks(data) {
  const now = Date.now();
  const minR = state.minReward === "" ? 0 : Number(state.minReward);
  const maxS = state.maxSubs === "" ? Infinity : Number(state.maxSubs);
  const endWithin = endingMs(state.ending);
  let rows = allOpenTasks(data).filter((t) => {
    if (state.chain !== "both" && String(t.chainId) !== state.chain) return false;
    if (!Number.isNaN(minR) && t.reward < minR) return false;
    if (Number.isFinite(maxS) && t.submissions > maxS) return false;
    if (state.free === "1" && !t.freeEntry) return false;
    if (state.category && t.mode !== state.category) return false;
    if (endWithin != null) {
      const left = Date.parse(t.expiry) - now;
      if (!Number.isFinite(left) || left < 0 || left > endWithin) return false;
    }
    return t.reward > 0;
  });
  const sorters = {
    opportunity: (a, b) => b.opportunity - a.opportunity || b.reward - a.reward,
    reward: (a, b) => b.reward - a.reward || a.submissions - b.submissions,
    competition: (a, b) => a.submissions - b.submissions || b.reward - a.reward,
    ending: (a, b) => Date.parse(a.expiry || 0) - Date.parse(b.expiry || 0),
  };
  rows.sort(sorters[state.sort] || sorters.opportunity);
  return rows;
}

function renderBoard(data) {
  const rows = filteredTasks(data);
  const total = allOpenTasks(data).filter((t) => t.reward > 0 && (state.chain === "both" || String(t.chainId) === state.chain)).length;
  $("#count").textContent = `${rows.length} shown of ${total} open paid tasks${state.chain === "both" ? "" : " on this chain"}`;
  if (!rows.length) {
    board.innerHTML = `<p class="err">No open paid tasks match these filters.</p>`;
    return;
  }
  const body = rows.map((t) => {
    const cat = t.mode || "—";
    const entry = t.freeEntry ? `<span class="pill yes">Free</span>` : `<span class="pill no">Fee</span>`;
    return `<tr>
      <td><div class="title">${escapeHtml(t.title)}</div><div class="ref">${escapeHtml(t.ref || "")} · ${escapeHtml(t.chain)}</div></td>
      <td class="num">${usd(t.reward)} ${escapeHtml(t.token)}</td>
      <td class="num">${escapeHtml(timeLeft(t.expiry))}</td>
      <td class="num">${fmt(t.submissions)}</td>
      <td>${escapeHtml(cat)}</td>
      <td>${entry}</td>
    </tr>`;
  }).join("");
  board.innerHTML = `<div class="table-wrap"><table class="tasks">
    <thead><tr>
      <th>Task</th>
      <th class="num">Reward</th>
      <th class="num">Time left</th>
      <th class="num">Submissions</th>
      <th>Category</th>
      <th>Entry</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mergeSeries(chains) {
  const map = new Map();
  for (const c of chains) {
    for (const row of c.series || []) {
      const cur = map.get(row.bucket) || { bucket: row.bucket, tasksCreated: 0, rewardVolume: 0, paidVolume: 0, activeAgents: 0, completedTasks: 0, settlements: 0 };
      cur.tasksCreated += row.tasksCreated;
      cur.rewardVolume += row.rewardVolume;
      cur.paidVolume += row.paidVolume;
      cur.activeAgents += row.activeAgents;
      cur.completedTasks += row.completedTasks;
      cur.settlements += row.settlements;
      map.set(row.bucket, cur);
    }
  }
  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function spark(rows, keys, colors, height = 180) {
  const w = 640, h = height, p = { l: 8, r: 8, t: 10, b: 18 };
  const iw = w - p.l - p.r, ih = h - p.t - p.b;
  const max = Math.max(1, ...rows.flatMap((r) => keys.map((k) => r[k] || 0)));
  const x = (i) => p.l + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const y = (v) => p.t + ih - (v / max) * ih;
  const paths = keys.map((k, ki) => {
    const d = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k] || 0).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${colors[ki]}" stroke-width="2"/>`;
  });
  const last = rows[rows.length - 1]?.bucket || "";
  const first = rows[0]?.bucket || "";
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"><rect x="0" y="0" width="${w}" height="${h}" fill="none"/>${paths.join("")}<text x="${p.l}" y="${h - 4}" fill="#B0A79D" font-size="10" font-family="Departure Mono,monospace">${first}</text><text x="${w - p.r}" y="${h - 4}" fill="#B0A79D" font-size="10" font-family="Departure Mono,monospace" text-anchor="end">${last}</text></svg>`;
}

function heat(hm) {
  if (!hm || !hm.cells) return "<p class='sub'>No heatmap.</p>";
  const cols = (hm.colKeys || []).map(Number);
  const max = hm.maxCount || 1;
  const map = new Map(hm.cells.map((c) => [`${c.row}-${c.col}`, c.count]));
  const cw = 18, rh = 14, pad = 16;
  const w = pad * 2 + (cols.length || 24) * cw, h = pad * 2 + 7 * rh + 6;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let cells = "";
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 24; c++) {
      const n = map.get(`${r}-${c}`) || 0;
      const a = n / max;
      const fill = n ? `rgba(231,64,121,${0.12 + a * 0.88})` : "#221E1A";
      cells += `<rect x="${pad + c * cw}" y="${pad + r * rh}" width="${cw - 1}" height="${rh - 1}" fill="${fill}"><title>${days[r] || r} ${String(c).padStart(2, "0")}:00 — ${n}</title></rect>`;
    }
  }
  return `<svg class="heat" viewBox="0 0 ${w} ${h}">${cells}</svg>`;
}

function insightText(chains) {
  const bits = [];
  let posted = 0, paid = 0, open = 0, expired = 0, completed = 0, cancelled = 0, topShare = 0, top5 = 0;
  for (const c of chains) {
    posted += c.insights.rewardPosted;
    paid += c.insights.rewardPaid;
    open += c.insights.open;
    expired += c.insights.expired;
    completed += c.insights.completed;
    cancelled += c.insights.cancelled;
    if (c.concentration) {
      if (c.concentration.top[0]) topShare = Math.max(topShare, c.concentration.top[0].share);
      if (c.concentration.top.length) {
        const s = c.concentration.top.slice(0, 5).reduce((a, x) => a + x.share, 0);
        top5 = Math.max(top5, s);
      }
    }
  }
  const settled = completed + expired + cancelled;
  const died = settled ? (expired + cancelled) / settled : 0;
  const payRatio = posted ? paid / posted : 0;
  bits.push(`Over this range, <strong>${usd(posted)}</strong> in rewards were put up and <strong>${usd(paid)}</strong> were paid (${fmt(payRatio * 100, 1)}% of what was posted).`);
  if (top5) bits.push(`Posting is concentrated: in the sampled window, one poster wallet accounted for as much as <strong>${fmt(topShare * 100, 0)}%</strong> of tasks on a chain, and the top five reached <strong>${fmt(top5 * 100, 0)}%</strong>.`);
  if (died) bits.push(`Of tasks that already ended (completed, expired or cancelled), <strong>${fmt(died * 100, 0)}%</strong> expired or were cancelled rather than completed.`);
  bits.push(`There are <strong>${fmt(open)}</strong> still-open tasks in the official breakdowns.`);
  return bits.join(" ");
}

function renderContext() {
  const data = state.data;
  if (!data) return;
  $("#asof").textContent = when(data.builtAt);
  $("#ttl").textContent = data.mode === "scheduled-build" ? "hourly scheduled build" : `cache ${Math.round((data.ttlMs || 0) / 1000)}s`;
  const chains = selectedChains(data);
  if (!chains.length) { root.innerHTML = `<p class="err">No chain data.</p>`; return; }

  const platform = data.platform || {};
  const series = platform.series || mergeSeries([chains[0]]);
  const h = data.headline || {};
  const open = h.openTasks;
  const activeA = h.activeAgents7d;
  const activeW = h.activeWorkers7d;
  let paidW, wallets;
  if (state.chain === "both") {
    paidW = h.paidWorkers;
    wallets = h.activeWallets;
  } else {
    paidW = chains[0].stats.paidWorkers;
    wallets = chains[0].stats.activeWallets;
  }

  const modes = {};
  const statuses = {};
  for (const m of (platform.breakdowns?.mode || chains[0].breakdowns.mode || [])) modes[m.mode] = m.count;
  for (const s of (platform.breakdowns?.status || chains[0].breakdowns.status || [])) statuses[s.status] = s.count;
  const modeRows = Object.entries(modes).sort((a, b) => b[1] - a[1]);
  const statusRows = Object.entries(statuses).sort((a, b) => b[1] - a[1]);
  const modeMax = Math.max(1, ...modeRows.map(([, n]) => n));
  const statusMax = Math.max(1, ...statusRows.map(([, n]) => n));

  const weeklyMap = new Map();
  for (const c of chains) {
    for (const w of c.postersWeekly || []) {
      const cur = weeklyMap.get(w.week) || { week: w.week, distinctPosters: 0, tasks: 0 };
      cur.distinctPosters += w.distinctPosters;
      cur.tasks += w.tasks;
      weeklyMap.set(w.week, cur);
    }
  }
  const weekly = [...weeklyMap.values()].sort((a, b) => a.week.localeCompare(b.week));
  const conc = [];
  if (state.chain !== "both") conc.push(...(chains[0].concentration?.top || []));
  const feed = (platform.feed || chains[0].feed || []).slice(0, 24);
  const posted = (platform.insights || chains[0].insights).rewardPosted;
  const paid = (platform.insights || chains[0].insights).rewardPaid;
  const insightBits = state.chain === "both"
    ? [{ insights: platform.insights || chains[0].insights, tasksSampled: chains.reduce((s, c) => s + (c.tasksSampled || 0), 0) }]
    : chains;

  root.innerHTML = `
    <article class="card"><h2>Open tasks</h2><div class="k">${fmt(open)}</div><div class="sub">from market/stats</div></article>
    <article class="card"><h2>Active agents, 7d</h2><div class="k">${fmt(activeA)}</div><div class="sub">${fmt(activeW)} active workers</div></article>
    <article class="card"><h2>Paid workers</h2><div class="k">${fmt(paidW)}</div><div class="sub">${fmt(wallets)} active wallets</div></article>
    <article class="card"><h2>Posted vs paid</h2><div class="k">${usd(paid)} <small>/ ${usd(posted)}</small></div><div class="sub">reward volume in this range, token units</div></article>
    <article class="card wide"><h2>Daily agents, tasks, rewards posted and paid</h2>${spark(series, ["activeAgents","tasksCreated","rewardVolume","paidVolume"], ["#EFE9E2","#D9A097","#E74079","#FFF6E8"])}<div class="sub">Cream: active agents · salmon: tasks posted · magenta: rewards put up · paper: rewards paid</div></article>
    <article class="card slim"><h2>What is not obvious</h2><p class="insight">${insightText(insightBits)}</p></article>
    <article class="card mid"><h2>Tasks by status</h2>${statusRows.map(([k,n]) => `<div class="row"><span>${k}</span><span class="mono">${fmt(n)}</span></div><div class="bar"><i style="width:${(n/statusMax)*100}%"></i></div>`).join("")}</article>
    <article class="card mid"><h2>Tasks by mode</h2>${modeRows.map(([k,n]) => `<div class="row"><span>${k}</span><span class="mono">${fmt(n)}</span></div><div class="bar"><i style="width:${(n/modeMax)*100}%"></i></div>`).join("")}</article>
    <article class="card mid"><h2>Distinct task posters per week</h2>${spark(weekly.map(w => ({bucket:w.week, distinctPosters:w.distinctPosters, tasks:w.tasks})), ["distinctPosters","tasks"], ["#E74079","#EFE9E2"], 160)}<div class="sub">Counted from requester addresses on /api/tasks, last 8 weeks. Magenta: distinct posters · cream: tasks.</div></article>
    <article class="card mid"><h2>Activity heatmap (hour of week, 7d)</h2>${heat(platform.heatmap || chains[0].heatmap)}<div class="sub">Platform-wide activity (the official heatmap is the same for both chain query params).</div></article>
    ${conc.length ? `<article class="card mid"><h2>Most frequent posters (sampled window)</h2>${conc.map(p => `<div class="row"><span class="mono">${p.poster}</span><span>${fmt(p.tasks)} · ${fmt(p.share*100,0)}%</span></div><div class="bar"><i style="width:${p.share*100}%"></i></div>`).join("")}<div class="sub">Truncated addresses only, no guessed identities.</div></article>` : `<article class="card mid"><h2>Most frequent posters</h2><p class="sub">Pick Tempo or Base in the filters to see per-chain concentration. Combined view would mix two ledgers.</p></article>`}
    <article class="card mid"><h2>Live activity</h2><div class="feed">${feed.map(e => `<div class="row"><span class="t">${new Date(e.timestamp).toISOString().slice(11,19)}</span><span>${e.type || "event"}${e.chainId ? " · chain " + e.chainId : ""}${e.taskTitle ? " · " + String(e.taskTitle).slice(0,72) : ""}</span></div>`).join("") || "<p class='sub'>No recent events.</p>"}</div></article>
  `;
}

function render() {
  if (!state.data) return;
  fillCategories(allOpenTasks(state.data));
  syncForm();
  renderBoard(state.data);
  renderContext();
}

async function load() {
  board.innerHTML = `<p class="err">Loading snapshot…</p>`;
  let data = null;
  try {
    const res = await fetch(`/api/snapshot?range=${encodeURIComponent(state.range)}`);
    if (res.ok) data = await res.json();
  } catch (_) { /* static host has no /api/snapshot */ }
  if (!data) {
    const res = await fetch(`/data/snapshot-${encodeURIComponent(state.range)}.json`);
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    data = await res.json();
  }
  state.data = data;
  render();
}

form?.addEventListener("input", () => {
  formToState();
  writeUrl();
  if (state.data) { renderBoard(state.data); renderContext(); }
});
form?.addEventListener("change", () => {
  formToState();
  writeUrl();
  if (state.data) { renderBoard(state.data); renderContext(); }
});
form?.addEventListener("reset", (e) => {
  e.preventDefault();
  const range = state.range;
  const data = state.data;
  Object.assign(state, DEFAULTS, { range, data });
  writeUrl();
  render();
});
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", async () => {
    state.range = btn.dataset.range;
    writeUrl();
    try { await load(); } catch (err) { board.innerHTML = `<p class="err">${err.message}</p>`; }
  });
});
window.addEventListener("popstate", async () => {
  Object.assign(state, readUrl());
  try { await load(); } catch (err) { board.innerHTML = `<p class="err">${err.message}</p>`; }
});

Object.assign(state, readUrl());
syncForm();
load().catch((e) => { board.innerHTML = `<p class="err">${e.message}</p>`; });
