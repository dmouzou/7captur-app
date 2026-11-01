// Predeploy build script for Firebase Hosting.
// Builds web/dist once, syncing shared schemas and plan definitions.
// Includes a cooldown cache check to prevent redundant rebuilds when deploying multiple hosting targets.
import { execSync } from "node:child_process";
import { statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stampFile = join(root, "web", "dist", ".build-stamp");

if (existsSync(stampFile)) {
  try {
    const ageMs = Date.now() - statSync(stampFile).mtimeMs;
    if (ageMs < 15000) {
      console.log("web/dist was built within the last 15s. Skipping duplicate build.");
      process.exit(0);
    }
  } catch {
    // Ignore stat error and proceed to build
  }
}

console.log("==> Building web application for Firebase Hosting deploy...");
execSync("node scripts/sync-shared.mjs", { cwd: root, stdio: "inherit" });
execSync("npm --prefix web run build", { cwd: root, stdio: "inherit" });

try {
  mkdirSync(join(root, "web", "dist"), { recursive: true });
  writeFileSync(stampFile, String(Date.now()));
} catch {
  // Non-fatal
}
console.log("==> Web build complete.");
