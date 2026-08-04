import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sendReleaseWebhook } from "./release-webhook.mjs";

function loadEnvironmentFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvironmentFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
loadEnvironmentFile(fileURLToPath(new URL("../.env", import.meta.url)));

const source = resolve(process.argv[2] ?? "release-staging");
const destination = resolve(process.argv[3] ?? "release");
const manifestPath = join(source, "latest.yml");

if (!existsSync(manifestPath)) throw new Error(`Update manifest not found: ${manifestPath}`);

const manifest = readFileSync(manifestPath, "utf8");
const version = manifest.match(/^version:\s*([^\s]+)$/m)?.[1];
const installerName = manifest.match(/^path:\s*(.+\.exe)$/m)?.[1]?.trim();
if (!version || !installerName) throw new Error("latest.yml is missing its version or installer path.");

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
if (version !== packageVersion) throw new Error(`Refusing to publish ${version}; package version is ${packageVersion}.`);

const notesPath = fileURLToPath(new URL("../release-notes.json", import.meta.url));
if (!existsSync(notesPath)) throw new Error(`Release notes not found: ${notesPath}`);
const notes = JSON.parse(readFileSync(notesPath, "utf8"));
if (notes.version !== version) throw new Error(`Release notes are for ${notes.version ?? "an unknown version"}; expected ${version}.`);

const compareVersions = (left, right) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
};

const liveManifestPath = join(destination, "latest.yml");
if (existsSync(liveManifestPath)) {
  const liveVersion = readFileSync(liveManifestPath, "utf8").match(/^version:\s*([^\s]+)$/m)?.[1];
  if (!liveVersion) throw new Error("The live update feed has an invalid latest.yml.");
  if (compareVersions(version, liveVersion) <= 0) throw new Error(`Refusing to publish ${version}; the live version is already ${liveVersion}.`);
}

// Keep the oldest supported differential source available. Electron Updater
// can then patch or fall back to the complete newest installer in one jump.
for (const file of ["Brava-Setup-0.33.0.exe", "Brava-Setup-0.33.0.exe.blockmap"]) {
  if (!existsSync(join(destination, file))) throw new Error(`Release blocked: missing 0.33 upgrade source ${file}.`);
}

const artifactFiles = [installerName, `${installerName}.blockmap`];
const files = ["latest.yml", ...artifactFiles];
for (const file of files) {
  const input = join(source, file);
  if (!existsSync(input)) throw new Error(`Update feed file not found: ${input}`);
}

const webhookUrl = process.env.BRAVA_RELEASE_WEBHOOK_URL?.trim();
if (!webhookUrl) {
  throw new Error("Release blocked: BRAVA_RELEASE_WEBHOOK_URL is not configured, so the changelog cannot be announced first.");
} else {
  const statePath = fileURLToPath(new URL("../.release-webhook-state.json", import.meta.url));
  const previousVersion = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8")).version
    : undefined;
  if (previousVersion === version) {
    console.log(`Release announcement already sent for Brava ${version}.`);
  } else {
    await sendReleaseWebhook({
      url: webhookUrl,
      version,
      notes,
      avatarPath: fileURLToPath(new URL("../build/webhook-avatar.png", import.meta.url)),
      pingEveryone: process.env.BRAVA_RELEASE_PING_EVERYONE === "true",
    });
    writeFileSync(statePath, `${JSON.stringify({ version, sentAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    console.log(`Sent Brava ${version} release announcement to Discord.`);
  }
}

mkdirSync(destination, { recursive: true });
for (const file of artifactFiles) {
  copyFileSync(join(source, file), join(destination, basename(file)));
}

// The manifest is the public release switch. Publish it only after the
// changelog succeeds and after every downloadable artifact is in place.
const manifestTemporaryPath = join(destination, `.latest-${process.pid}.yml.tmp`);
copyFileSync(manifestPath, manifestTemporaryPath);
try {
  renameSync(manifestTemporaryPath, liveManifestPath);
} catch (error) {
  rmSync(manifestTemporaryPath, { force: true });
  throw error;
}

console.log(`Published Brava ${version} update feed to ${destination} after its changelog announcement.`);
