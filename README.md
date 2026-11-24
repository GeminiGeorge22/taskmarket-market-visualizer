# Taskmarket live visualizer

A public, server-fetched dashboard of [Taskmarket](https://taskmarket.dev) on Tempo (4217) and Base (8453). Read-only. No wallet. No analytics.

The first view is a filterable list of **open tasks with escrowed rewards**: reward, time left, submissions, category, and whether entry is free. Default sort is best opportunity (high reward, low competition). Filters (min reward, ending soon, max submissions, free entry, category, chain, sort) are stored in the URL so a view can be shared.

Made for a paid Taskmarket bounty and is not an official Taskmarket product.

## One-command deploy (Node 22 host, live cache)

```bash
node server.mjs
```

Then open `http://127.0.0.1:8787`. Optional environment:

- `PORT` (default `8787`)
- `HOST` (default `0.0.0.0`)
- `DATA_TTL_MS` (default `300000`, minimum `60000`)

The server fetches official public endpoints at `https://api.taskmarket.dev` on demand, caches the snapshot for at least 60 seconds, and stamps every response with a visible "data as of" time.

## One-command static snapshot (GitHub Pages or any static host)

```bash
node build.mjs
```

This writes `public/data/snapshot-7d.json` (and 30d, 90d, all). The dashboard falls back to those files when `/api/snapshot` is not available. The included GitHub Actions workflow runs `node build.mjs` at least hourly and publishes `public/` to GitHub Pages, which satisfies "scheduled build, refreshed at least hourly."

To use Pages: create a public repo, push this tree, and enable GitHub Pages with the source "GitHub Actions."

## What it shows

Headline market stats, daily active agents, tasks posted, rewards put up and rewards paid (with 7d / 30d / 90d / all range switches), tasks by mode and status, the hour-of-week heatmap, a live activity feed, both chains, and distinct task posters per week computed from requester addresses on `/api/tasks`.

Official breakdowns, time series, heatmap and activity feed are platform-wide (the same body for every `chainId`). Combined-view headlines do not double-count those series.

## Licence

MIT. Brand fonts and marks in `public/brand/` remain under their own licences (SIL OFL for the fonts; Taskmarket marks used as provided in the public brand kit).
