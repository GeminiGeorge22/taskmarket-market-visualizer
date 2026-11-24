#!/usr/bin/env node
/**
 * Taskmarket live visualizer — fetches official public APIs on the server,
 * caches the snapshot for at least 60 seconds, and serves the dashboard.
 * Read-only. No wallet connection. No analytics.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, ttlMs as envTtl } from "./lib/snapshot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const TTL_MS = envTtl();

let snapshot = null;
let snapshotAt = 0;
let inflight = null;
let lastError = null;

async function getSnapshot(range = "30d") {
  const now = Date.now();
  if (snapshot && now - snapshotAt < TTL_MS && snapshot.range === range) return snapshot;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await buildSnapshot(range, { ttlMs: TTL_MS, mode: "server-cache" });
      data.range = range;
      snapshot = data;
      snapshotAt = Date.now();
      lastError = null;
      return data;
    } catch (err) {
      lastError = String(err && err.message ? err.message : err);
      if (snapshot) return snapshot;
      throw err;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": extra.cache || "no-store",
    "x-content-type-options": "nosniff",
    ...extra.headers,
  });
  res.end(body);
}

function safeJoin(root, reqPath) {
  const clean = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, clean);
  if (!full.startsWith(root)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "method not allowed");
      return;
    }
    if (url.pathname === "/api/snapshot") {
      const range = ["7d", "30d", "90d", "all"].includes(url.searchParams.get("range"))
        ? url.searchParams.get("range")
        : "30d";
      const data = await getSnapshot(range);
      const body = JSON.stringify(data);
      send(res, 200, body, "application/json; charset=utf-8", {
        cache: `public, max-age=60, stale-while-revalidate=120`,
        headers: {
          "x-data-as-of": data.builtAt,
          "x-cache-ttl-ms": String(TTL_MS),
        },
      });
      return;
    }
    if (url.pathname === "/health") {
      send(
        res,
        200,
        JSON.stringify({ ok: true, snapshotAt: snapshotAt ? new Date(snapshotAt).toISOString() : null, lastError }),
        "application/json; charset=utf-8"
      );
      return;
    }
    let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = safeJoin(PUBLIC, reqPath);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      send(res, 404, "not found");
      return;
    }
    const ext = path.extname(file);
    const type = TYPES[ext] || "application/octet-stream";
    const cache = ext.match(/\.(woff2|ttf|otf|png)$/) ? "public, max-age=86400" : "public, max-age=60";
    send(res, 200, fs.readFileSync(file), type, { cache });
  } catch (err) {
    send(res, 500, JSON.stringify({ error: "server_error", message: String(err.message || err) }), "application/json; charset=utf-8");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`taskmarket visualizer http://${HOST}:${PORT} ttl=${TTL_MS}ms`);
});
