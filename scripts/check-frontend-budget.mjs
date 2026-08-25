import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const DIST_DIR = "dist";
const KIB = 1024;
const BUDGETS = {
  javascriptRaw: 430 * KIB,
  cssRaw: 120 * KIB,
  combinedGzip: 145 * KIB,
};

const assets = await collectAssets(DIST_DIR);
if (assets.length === 0) {
  throw new Error("No built JavaScript or CSS assets found in dist/. Run the production build first.");
}

let javascriptRaw = 0;
let cssRaw = 0;
let combinedGzip = 0;

for (const asset of assets) {
  const contents = await readFile(asset);
  const raw = contents.byteLength;
  const gzip = gzipSync(contents, { level: 9 }).byteLength;
  combinedGzip += gzip;
  if (extname(asset) === ".js") javascriptRaw += raw;
  if (extname(asset) === ".css") cssRaw += raw;
  console.log(`${relative(DIST_DIR, asset)}: ${format(raw)} raw · ${format(gzip)} gzip`);
}

const measurements = [
  ["JavaScript raw", javascriptRaw, BUDGETS.javascriptRaw],
  ["CSS raw", cssRaw, BUDGETS.cssRaw],
  ["JS + CSS gzip", combinedGzip, BUDGETS.combinedGzip],
];

let failed = false;
for (const [label, actual, budget] of measurements) {
  const remaining = budget - actual;
  console.log(
    `${label}: ${format(actual)} / ${format(budget)} ` +
      `(${remaining >= 0 ? `${format(remaining)} headroom` : `${format(-remaining)} over`})`,
  );
  if (actual > budget) failed = true;
}

if (failed) {
  console.error(
    "Frontend bundle budget exceeded. Prefer lazy loading/code splitting or justify and deliberately raise the budget.",
  );
  process.exitCode = 1;
}

async function collectAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectAssets(path));
      continue;
    }
    if (entry.isFile() && [".js", ".css"].includes(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

function format(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}
