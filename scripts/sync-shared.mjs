// Copies /shared (canonical plan config + zod schemas) into web and functions.
// Functions deploy uploads only /functions, so a relative import out of it would break.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const target of ["web/src/shared", "functions/src/shared"]) {
  mkdirSync(join(root, target), { recursive: true });
  cpSync(join(root, "shared"), join(root, target), { recursive: true });
}
console.log("shared/ synced to web and functions");
