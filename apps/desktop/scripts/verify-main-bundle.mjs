import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bundlePath = resolve("dist/main/index.js");
const bundle = readFileSync(bundlePath, "utf8");
const incompatibleNamedImport = /import\s*\{[^}]*\bautoUpdater\b[^}]*}\s*from\s*["']electron-updater["']/m;
const compatibleDefaultImport = /import\s+[A-Za-z_$][\w$]*\s+from\s+["']electron-updater["']/m;

if (incompatibleNamedImport.test(bundle)) {
  throw new Error("Main bundle contains the incompatible named autoUpdater import from electron-updater.");
}
if (!compatibleDefaultImport.test(bundle)) {
  throw new Error("Main bundle does not contain the required CommonJS-compatible electron-updater default import.");
}

console.log("Main bundle verification passed: electron-updater uses a CommonJS-compatible default import.");
