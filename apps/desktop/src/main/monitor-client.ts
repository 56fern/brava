import type { BrowserWindow } from "electron";
import type { MonitorState, ProductSignal } from "../shared/types.js";
import { activeLicenseToken, serverEndpoint } from "./license-client.js";

type ServerHealth = {
  status: "healthy" | "degraded" | "offline" | "idle";
  sourceCount: number;
  healthySources: number;
  signalCount: number;
  latestSequence: number;
  latestSignal: ProductSignal | null;
};

const initialState = (): MonitorState => ({
  status: "disconnected",
  message: "Monitor is disconnected.",
  sourceCount: 0,
  healthySources: 0,
  signalCount: 0,
  latestSequence: 0,
});

export class MonitorClient {
  private current = initialState();
  private apiUrl = "";
  private cursor = 0;
  private timer?: NodeJS.Timeout;
  private refreshing = false;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly onSignal: (signal: ProductSignal) => Promise<void>,
  ) {}

  state(): MonitorState { return this.current; }

  async connect(apiUrl: string): Promise<MonitorState> {
    this.disconnect();
    this.apiUrl = apiUrl;
    this.set({ ...initialState(), status: "connecting", message: "Connecting to the Brava monitor…" });
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5_000);
    return this.current;
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.apiUrl = "";
    this.cursor = 0;
    this.set(initialState());
  }

  async refresh(): Promise<MonitorState> {
    if (!this.apiUrl || this.refreshing) return this.current;
    this.refreshing = true;
    try {
      const healthResponse = await fetch(serverEndpoint(this.apiUrl, "v1/monitor/health"));
      if (!healthResponse.ok) throw new Error(`Monitor health returned HTTP ${healthResponse.status}`);
      const health = await healthResponse.json() as ServerHealth;
      if (health.latestSequence < this.cursor) this.cursor = 0;
      const token = activeLicenseToken();
      if (!token) throw new Error("Waiting for an active license session");
      const signalsResponse = await fetch(serverEndpoint(this.apiUrl, `v1/monitor/signals?after=${this.cursor}`), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!signalsResponse.ok) throw new Error(`Monitor signal stream returned HTTP ${signalsResponse.status}`);
      const body = await signalsResponse.json() as { signals: ProductSignal[]; latestSequence: number };
      for (const signal of body.signals.sort((a, b) => a.sequence - b.sequence)) {
        this.cursor = Math.max(this.cursor, signal.sequence);
        this.window()?.webContents.send("monitor:signal", signal);
        await this.onSignal(signal);
      }
      this.cursor = Math.max(this.cursor, body.latestSequence);
      const status = health.status;
      const message = status === "healthy"
        ? `${health.healthySources}/${health.sourceCount} sources live`
        : status === "idle"
          ? "Connected; no product sources are configured"
          : `${health.healthySources}/${health.sourceCount} sources available`;
      this.set({ ...health, latestSignal: health.latestSignal ?? undefined, status, message, checkedAt: new Date().toISOString() });
    } catch (error) {
      this.set({ ...this.current, status: "offline", message: error instanceof Error ? error.message : "Monitor connection failed", checkedAt: new Date().toISOString() });
    } finally { this.refreshing = false; }
    return this.current;
  }

  private set(state: MonitorState): void {
    this.current = state;
    this.window()?.webContents.send("monitor:state", state);
  }
}
