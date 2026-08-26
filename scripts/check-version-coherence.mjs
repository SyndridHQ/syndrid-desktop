import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const cargoToml = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const appServerClient = readFileSync(
  new URL("../src/runtime/appServerClient.ts", import.meta.url),
  "utf8",
);
const cargoPackage = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
const initializeClientVersion = appServerClient.match(
  /clientInfo:\s*\{[\s\S]*?name:\s*"syndrid_desktop"[\s\S]*?version:\s*"([^"]+)"/m,
);

if (!cargoPackage) {
  console.error("Version check failed: could not read [package] version from src-tauri/Cargo.toml.");
  process.exit(1);
}

if (!initializeClientVersion) {
  console.error(
    "Version check failed: could not read the Syndrid Desktop initialize client version from src/runtime/appServerClient.ts.",
  );
  process.exit(1);
}

const versions = {
  packageJson: packageJson.version,
  tauriConfig: tauriConfig.version,
  cargoPackage: cargoPackage[1],
  appServerClient: initializeClientVersion[1],
};
const uniqueVersions = new Set(Object.values(versions));

if (uniqueVersions.size !== 1) {
  console.error("Version check failed: Desktop release versions disagree.");
  for (const [source, version] of Object.entries(versions)) {
    console.error(`  ${source}: ${String(version)}`);
  }
  process.exit(1);
}

console.log(`Desktop release version coherent: ${versions.packageJson}`);
