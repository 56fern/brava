import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const executable = resolve(process.env.BRAVA_SMOKE_EXECUTABLE ?? process.argv[2] ?? "release-staging/win-unpacked/Brava.exe");
if (!existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

const temporary = mkdtempSync(join(tmpdir(), "brava-launch-smoke-"));
const probe = join(temporary, "launch.jsonl");
const profile = join(temporary, "profile");
const required = ["profile-ready", "app-ready", "window-created", "renderer-started", "renderer-loaded", "window-visible", "window-mode"];
let finished = false;

const child = spawn(executable, [], {
  cwd: dirname(executable),
  env: {
    ...process.env,
    BRAVA_USER_DATA: profile,
    BRAVA_LAUNCH_PROBE: probe,
    BRAVA_UPDATE_URL: "http://127.0.0.1:9/updates",
  },
  stdio: "ignore",
});
child.once("exit", () => { finished = true; });

const stop = () => {
  if (!finished) {
    child.kill();
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
};

try {
  const deadline = Date.now() + 20_000;
  let stages = [];
  while (Date.now() < deadline) {
    if (existsSync(probe)) {
      stages = readFileSync(probe, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).stage);
      if (required.every((stage) => stages.includes(stage))) break;
    }
    if (finished) throw new Error(`Brava exited before its window loaded. Stages: ${stages.join(", ")}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }

  const finalStages = existsSync(probe)
    ? readFileSync(probe, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).stage)
    : [];
  const missing = required.filter((stage) => !finalStages.includes(stage));
  if (missing.length) throw new Error(`Launch smoke test timed out. Missing: ${missing.join(", ")}`);
  const records = readFileSync(probe, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const activationMode = records.find((record) => record.stage === "window-mode" && record.mode === "activation");
  if (!activationMode || activationMode.width !== 460 || activationMode.height !== 460) {
    throw new Error(`Activation window size verification failed: ${JSON.stringify(activationMode ?? null)}`);
  }

  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  if (finished) throw new Error("Brava crashed after showing its window.");
  console.log(`Launch smoke test passed: ${required.join(" -> ")} (activation 460x460)`);
} finally {
  stop();
  await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.warn(`Launch smoke test passed, but Windows retained temporary files at ${temporary}`);
  }
}
