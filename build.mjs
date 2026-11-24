#!/usr/bin/env node
/**
 * Scheduled / one-shot snapshot build.
 * Fetches official Taskmarket APIs on this machine and writes static JSON
 * under public/data/ so a static host (GitHub Pages) can serve the dashboard.
 * One command: node build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "./lib/snapshot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "public", "data");
const RANGES = ["7d", "30d", "90d", "all"];
const TTL_MS = Math.max(60_000, 3_600_000); // advertise hourly refresh

fs.mkdirSync(OUT, { recursive: true });

for (const range of RANGES) {
  const data = await buildSnapshot(range, { ttlMs: TTL_MS, mode: "scheduled-build" });
  data.range = range;
  const dest = path.join(OUT, `snapshot-${range}.json`);
  fs.writeFileSync(dest, JSON.stringify(data));
  console.log("wrote", dest, "builtAt", data.builtAt, "bytes", fs.statSync(dest).size);
}

const index = {
  builtAt: new Date().toISOString(),
  files: RANGES.map((r) => `/data/snapshot-${r}.json`),
  refresh: "hourly scheduled build",
};
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log("ok", RANGES.length, "snapshots");
