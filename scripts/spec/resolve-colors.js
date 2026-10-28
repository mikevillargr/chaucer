#!/usr/bin/env node
// Resolve gm3_sys_color_* tokens from an `aapt dump --values resources` file
// (default config only), following color references to literal values.
const fs = require("fs");

const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const byId = new Map(); // id -> { name, type, data }
let cfg = "";
for (const line of lines) {
  const c = line.match(/^\s+config (.+):$/);
  if (c) { cfg = c[1]; continue; }
  if (cfg !== "(default)") continue;
  const m = line.match(/^\s+resource (0x[0-9a-f]+) [\w.]+:color\/(\w+): t=(0x[0-9a-f]+) d=(0x[0-9a-f]+)/);
  if (m) byId.set(m[1], { name: m[2], type: parseInt(m[3], 16), data: m[4] });
}

function resolve(id, depth = 0) {
  const r = byId.get(id);
  if (!r || depth > 10) return null;
  if (r.type === 0x01) return resolve(r.data, depth + 1);
  if (r.type >= 0x1c && r.type <= 0x1f) return "#" + r.data.slice(2).padStart(8, "0").slice(2);
  return null;
}

const out = [];
for (const [id, r] of byId) {
  const m = r.name.match(/^gm3_sys_color_(light|dark)_(\w+)$/);
  if (m) out.push([m[2], m[1], resolve(id)]);
}
const tokens = {};
for (const [name, mode, hex] of out) (tokens[name] ??= {})[mode] = hex;
console.log("| Token | Light | Dark |\n| --- | --- | --- |");
for (const name of Object.keys(tokens).sort())
  console.log(`| ${name} | ${tokens[name].light ?? ""} | ${tokens[name].dark ?? ""} |`);
