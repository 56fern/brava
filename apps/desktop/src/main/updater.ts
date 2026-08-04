import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateState } from "../shared/types.js";

const defaultFeed = "http://127.0.0.1:4310/updates";
const { autoUpdater } = electronUpdater;

export class UpdateController {
  private readonly currentVersion = app.getVersion();
  private current: UpdateState = { status: "idle", currentVersion: this.currentVersion, message: "Ready to check." };

  constructor(private readonly window: () => BrowserWindow | null) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.BRAVA_UPDATE_URL ?? defaultFeed });
    autoUpdater.on("checking-for-update", () => this.set({ status: "checking", message: "Checking for updates…" }));
    autoUpdater.on("update-available", (info) => this.set({ status: "available", version: info.version, message: `Version ${info.version} is available.` }));
    autoUpdater.on("update-not-available", () => this.set({ status: "current", message: "You have the latest version." }));
    autoUpdater.on("download-progress", (progress) => this.set({ status: "downloading", version: this.current.version, percent: Math.round(progress.percent), message: `Downloading ${Math.round(progress.percent)}%` }));
    autoUpdater.on("update-downloaded", (info) => this.set({ status: "downloaded", version: info.version, percent: 100, message: `Version ${info.version} is ready.` }));
    autoUpdater.on("error", (error) => this.set({ status: "error", message: this.errorMessage(error) }));
  }

  state(): UpdateState { return this.current; }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return this.set({ status: "current", message: "Development build." });
    try { await autoUpdater.checkForUpdates(); } catch (error) { this.set({ status: "error", message: this.errorMessage(error) }); }
    return this.current;
  }

  async download(): Promise<void> {
    if (this.current.status !== "available") return;
    await autoUpdater.downloadUpdate();
  }

  install(): void {
    if (this.current.status !== "downloaded") return;
    autoUpdater.quitAndInstall(false, true);
  }

  private errorMessage(error: unknown): string {
    const detail = error instanceof Error ? error.message : "Unknown error";
    if (/ECONNREFUSED|ERR_CONNECTION_REFUSED|Cannot download/i.test(detail)) return "Update server is offline.";
    return `Could not check for updates: ${detail}`;
  }

  private set(state: Omit<UpdateState, "currentVersion">): UpdateState {
    this.current = { ...state, currentVersion: this.currentVersion };
    this.window()?.webContents.send("update:state", this.current);
    return this.current;
  }
}
