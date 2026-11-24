/**
 * Shared snapshot builder for the Taskmarket live visualizer.
 * Fetches official public APIs. Read-only. No wallet. No analytics.
 */
export const API = "https://api.taskmarket.dev";
export const CHAINS = [
  { id: 4217, name: "Tempo", token: "OUSD" },
  { id: 8453, name: "Base", token: "USDC" },
];
export const MIN_TTL_MS = 60_000;
export const UA = "taskmarket-live-visualizer/1.0 (read-only dashboard)";

export function ttlMs(env = process.env) {
  return Math.max(MIN_TTL_MS, Number(env.DATA_TTL_MS || 300_000));
}

function units(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n / 1e6 : 0;
}

function weekKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function paginateTasks(chainId, weeks = 8) {
  const cutoff = Date.now() - weeks * 7 * 86400_000;
  const out = [];
  let cursor = null;
  for (let i = 0; i < 40; i++) {
    const u = new URL(`${API}/api/tasks`);
    u.searchParams.set("chainId", String(chainId));
    u.searchParams.set("sort", "newest");
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    const data = await fetchJson(u);
    const tasks = data.tasks || [];
    if (!tasks.length) break;
    out.push(...tasks);
    const last = tasks[tasks.length - 1];
    const created = last?.createdAt ? Date.parse(last.createdAt) : NaN;
    if (Number.isFinite(created) && created < cutoff) break;
    cursor = data.nextCursor;
    if (!data.hasMore || !cursor) break;
  }
  return out.filter((t) => {
    const created = t?.createdAt ? Date.parse(t.createdAt) : 0;
    return created >= cutoff;
  });
}


const FREE_SUBMISSION_CAP = 50;

async function paginateOpenTasks(chainId) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 40; i++) {
    const u = new URL(`${API}/api/tasks`);
    u.searchParams.set("chainId", String(chainId));
    u.searchParams.set("status", "open");
    u.searchParams.set("sort", "newest");
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    const data = await fetchJson(u);
    const tasks = data.tasks || [];
    if (!tasks.length) break;
    out.push(...tasks);
    cursor = data.nextCursor;
    if (!data.hasMore || !cursor) break;
  }
  return out;
}

function taskTitle(t) {
  const raw = String(t.description || t.title || t.name || "");
  const line = raw.split("\n").map((s) => s.replace(/^#+\s*/, "").trim()).find(Boolean);
  return (line || t.referenceCode || "Untitled task").slice(0, 160);
}

function slimOpenPaid(t, chain) {
  const reward = units(t.reward || t.netReward);
  const submissions = Number(t.submissionCount || 0);
  const stakeRequired = Boolean(t.stakeRequired);
  return {
    ref: t.referenceCode || null,
    title: taskTitle(t),
    chainId: chain.id,
    chain: chain.name,
    token: chain.token,
    reward,
    submissions,
    expiry: t.expiryTime || null,
    mode: t.mode || "",
    tags: Array.isArray(t.tags) ? t.tags.slice(0, 8) : [],
    stakeRequired,
    // Official worker submit fee: first 5 submits per wallet per task are free
    // until the task has 50 total submissions; then 0.001 of the payment token.
    // A required stake is also not free entry. We do not guess per-wallet used submits.
    freeEntry: !stakeRequired && submissions < FREE_SUBMISSION_CAP,
    opportunity: reward / (1 + submissions),
  };
}

function postersByWeek(tasks) {
  const weeks = {};
  for (const t of tasks) {
    const w = weekKey(t.createdAt);
    const poster = (t.requester || "").toLowerCase();
    if (!w || !poster) continue;
    if (!weeks[w]) weeks[w] = {};
    weeks[w][poster] = (weeks[w][poster] || 0) + 1;
  }
  return Object.keys(weeks)
    .sort()
    .map((week) => {
      const counts = Object.values(weeks[week]);
      const total = counts.reduce((a, b) => a + b, 0);
      const distinct = counts.length;
      const sorted = counts.sort((a, b) => b - a);
      const top1 = sorted[0] || 0;
      const top5 = sorted.slice(0, 5).reduce((a, b) => a + b, 0);
      return {
        week,
        distinctPosters: distinct,
        tasks: total,
        topPosterShare: total ? top1 / total : 0,
        top5Share: total ? top5 / total : 0,
      };
    });
}

function concentration(tasks) {
  const by = {};
  for (const t of tasks) {
    const p = (t.requester || "").toLowerCase();
    if (!p) continue;
    by[p] = (by[p] || 0) + 1;
  }
  const entries = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const top = entries.slice(0, 8).map(([addr, n], i) => ({
    rank: i + 1,
    tasks: n,
    share: total ? n / total : 0,
    poster: addr.slice(0, 6) + "…" + addr.slice(-4),
  }));
  return { distinctPosters: entries.length, tasks: total, top };
}

async function loadChain(chain, range) {
  const id = chain.id;
  const [stats, breakdowns, series, heatmap, feed, tasks, openTasks] = await Promise.all([
    fetchJson(`${API}/api/market/stats?chainId=${id}`),
    fetchJson(`${API}/api/stats/breakdowns?chainId=${id}`),
    fetchJson(`${API}/api/stats/platform-time-series?chainId=${id}&range=${range}&bucket=day`),
    fetchJson(`${API}/api/stats/activity-heatmap?chainId=${id}&range=7d&dimension=hourOfWeek`),
    fetchJson(`${API}/api/stats/activity-feed?chainId=${id}&limit=40`),
    paginateTasks(id, 8),
    paginateOpenTasks(id),
  ]);
  const seriesNorm = (Array.isArray(series) ? series : []).map((row) => ({
    bucket: row.bucket,
    tasksCreated: row.tasksCreated || 0,
    rewardVolume: units(row.rewardVolume),
    paidVolume: units(row.paidVolume),
    completedTasks: row.completedTasks || 0,
    newAgents: row.newAgents || 0,
    activeAgents: row.activeAgents || 0,
    settlements: row.settlements || 0,
  }));
  const posted = seriesNorm.reduce((s, r) => s + r.rewardVolume, 0);
  const paid = seriesNorm.reduce((s, r) => s + r.paidVolume, 0);
  const expired = (breakdowns.status || []).find((s) => s.status === "expired")?.count || 0;
  const completed = (breakdowns.status || []).find((s) => s.status === "completed")?.count || 0;
  const cancelled = (breakdowns.status || []).find((s) => s.status === "cancelled")?.count || 0;
  const open = (breakdowns.status || []).find((s) => s.status === "open")?.count || 0;
  const settledish = completed + expired + cancelled;
  return {
    id,
    name: chain.name,
    token: chain.token,
    stats,
    breakdowns,
    series: seriesNorm,
    heatmap,
    feed: (feed.items || []).map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      taskTitle: e.taskTitle,
      chainId: e.chainId,
    })),
    postersWeekly: postersByWeek(tasks),
    concentration: concentration(tasks),
    tasksSampled: tasks.length,
    openPaidTasks: openTasks.map((task) => slimOpenPaid(task, chain)).filter((task) => task.reward > 0),
    insights: {
      rewardPosted: posted,
      rewardPaid: paid,
      paidOfPosted: posted ? paid / posted : 0,
      expired,
      completed,
      cancelled,
      open,
      diedShare: settledish ? (expired + cancelled) / settledish : 0,
    },
  };
}

export async function buildSnapshot(range, options = {}) {
  const TTL_MS = options.ttlMs ?? ttlMs();
  const mode = options.mode || "server-cache";
  const builtAt = new Date().toISOString();
  const chains = {};
  const results = await Promise.all(CHAINS.map((c) => loadChain(c, range)));
  for (const row of results) chains[row.id] = row;
  const first = results[0];
  const headline = {
    registeredWorkers: first?.stats?.registeredWorkers ?? null,
    activeWorkers7d: first?.stats?.activeWorkers7d ?? null,
    activeAgents7d: first?.stats?.activeAgents7d ?? null,
    openTasks: first?.stats?.openTasks ?? null,
    paidWorkers: results.reduce((s, r) => s + (r.stats?.paidWorkers || 0), 0),
    activeWallets: results.reduce((s, r) => s + (r.stats?.activeWallets || 0), 0),
    perChain: results.map((r) => ({
      id: r.id,
      name: r.name,
      token: r.token,
      paidWorkers: r.stats?.paidWorkers,
      activeWallets: r.stats?.activeWallets,
    })),
    sharedAcrossChainIds: ["registeredWorkers", "activeWorkers7d", "activeAgents7d", "openTasks", "breakdowns", "series", "heatmap", "feed"],
  };
  const platform = first
    ? {
        breakdowns: first.breakdowns,
        series: first.series,
        heatmap: first.heatmap,
        feed: first.feed,
        insights: first.insights,
      }
    : null;
  const refresh =
    mode === "scheduled-build"
      ? "A scheduled build (GitHub Actions, hourly) fetches the official APIs on the runner, writes static JSON under /data, and publishes the site. Visible data-as-of is the build time. Rebuilds at least hourly."
      : `Server fetches on demand, caches at least 60s (current TTL ${Math.round(TTL_MS / 1000)}s), refreshes when a request arrives after expiry.`;
  return {
    builtAt,
    ttlMs: TTL_MS,
    mode,
    platform,
    endpoints: [
      "/api/market/stats?chainId=",
      "/api/stats/breakdowns?chainId=",
      "/api/stats/platform-time-series?chainId=&range=&bucket=day",
      "/api/stats/activity-heatmap?chainId=&range=7d&dimension=hourOfWeek",
      "/api/stats/activity-feed?chainId=&limit=",
      "/api/tasks?chainId=&sort=newest&limit=100",
    ],
    headline,
    chains,
    openPaidTasks: results
      .flatMap((r) => r.openPaidTasks || [])
      .sort((a, b) => b.opportunity - a.opportunity || b.reward - a.reward),
    freeEntryRule: "Worker submit is free for the first 5 submits per wallet per task until the task has 50 total submissions; after that the fee is 0.001 of the payment token. A required stake is also not free entry.",
    methods: {
      source: API,
      refresh,
      posters: "Distinct posters per week are counted from requester addresses on /api/tasks (newest, last 8 weeks, no name lookup).",
      openPaidTasks: "Open tasks with a positive reward are listed from /api/tasks?status=open on each chain. Reward is the escrowed amount in token units (1e6). Free entry follows the public 50-submission fee rule. Default sort is opportunity: reward / (1 + submissions).",
      sharedStats: "Official breakdowns, time series, heatmap and activity feed are platform-wide (identical for every chainId). market/stats shares registeredWorkers, 7d actives and openTasks; paidWorkers and activeWallets are per-chain and summed in the combined view (a wallet paid on both chains is counted twice).",
    },
  };
}
