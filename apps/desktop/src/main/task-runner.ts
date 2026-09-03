import type { BrowserWindow } from "electron";
import type { AppStore } from "./store.js";
import type { CheckoutOutcome } from "./checkout-automation.js";
import type { ProductSignal, Profile, Task, TaskStatus } from "../shared/types.js";
import { notifyTask } from "./webhook-notifier.js";
import { publishPublicCheckout } from "./public-checkout-client.js";
import { SharedScheduler, type SchedulerStats } from "./shared-scheduler.js";
import { resolveCartQuantity } from "../shared/cart-quantity.js";
const defaultQueueCheckIntervalMinutes = 3;
const cartResultTimeoutMs = 15_000;
const productProbeIntervalMs = 30_000;

function queueCheckInterval(task: Task): number {
  return Math.min(10, Math.max(2, task.queueCheckIntervalMinutes ?? defaultQueueCheckIntervalMinutes));
}

function waitingForLiveSku(task: Task): boolean {
  const sku = task.sku?.trim().toUpperCase();
  return task.usePlaceholder === true || (!sku && !task.productUrl?.trim()) || sku === "PLACEHOLDER";
}

function formatQueueEta(seconds: number): string {
  if (seconds < 60) return "less than 1 minute";
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function taskMatchesSignal(task: Task, signal: ProductSignal): boolean {
  if (signal.site !== "pokemon_center_us" || !signal.available) return false;
  if (task.productUrl && task.productUrl === signal.productUrl) return true;
  const terms = (task.monitorKeywords ?? "").split(",").map((term) => term.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return false;
  if (waitingForLiveSku(task) && terms.every((term) => term === "placeholder")) return false;
  const searchable = `${signal.name} ${signal.sku} ${signal.productUrl}`.toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function cartQuantityPatch(task: Task, maximum?: number): Pick<Task, "quantity" | "effectiveQuantity" | "maxCartQuantity"> {
  const resolved = resolveCartQuantity(task.quantity, maximum);
  return { quantity: resolved.requested, effectiveQuantity: resolved.effective, maxCartQuantity: resolved.maximum };
}

function cartQuantityMessage(task: Task): string {
  const resolved = resolveCartQuantity(task.quantity, task.maxCartQuantity);
  return resolved.clamped
    ? `Adding ${resolved.effective} to cart (requested ${resolved.requested}, store limit ${resolved.maximum})`
    : `Adding ${resolved.effective} to cart`;
}

export class TaskRunner {
  private readonly pendingUpdates = new Map<string, Task>();
  private updateTimer: NodeJS.Timeout | undefined;
  private challengeHandlers: {
    request: (taskId: string, challengeUrl: string) => Promise<void>;
    cancel: (taskId: string) => Promise<void>;
  } | undefined;
  private checkoutHandlers: { run: (task: Task, profile: Profile, harvesterId: string) => Promise<CheckoutOutcome> } | undefined;
  private productProbe: ((sku: string) => Promise<ProductSignal | null>) | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly window: () => BrowserWindow | null,
    private readonly scheduler = new SharedScheduler(16, (key, error) => {
      const taskId = key.split(":", 1)[0];
      if (taskId) void this.update(taskId, "error", `Task engine isolated an error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }),
  ) {}

  setChallengeHandlers(handlers: {
    request: (taskId: string, challengeUrl: string) => Promise<void>;
    cancel: (taskId: string) => Promise<void>;
  }): void {
    this.challengeHandlers = handlers;
  }

  setProductProbe(probe: (sku: string) => Promise<ProductSignal | null>): void {
    this.productProbe = probe;
  }

  private async update(id: string, status: TaskStatus, statusMessage: string, patch: Partial<Task> = {}): Promise<Task | undefined> {
    const updatedAt = new Date().toISOString();
    const task = typeof this.store.updateTask === "function"
      ? await this.store.updateTask(id, (current) => {
          const history = [...(current.history ?? []), { status, message: statusMessage, at: updatedAt }].slice(-30);
          Object.assign(current, patch, { status, statusMessage, updatedAt, history });
        })
      : await this.updateLegacy(id, status, statusMessage, updatedAt, patch);
    if (!task) return undefined;
    this.queueRendererUpdate(task);
    return task;
  }

  private async updateLegacy(id: string, status: TaskStatus, statusMessage: string, updatedAt: string, patch: Partial<Task>): Promise<Task | undefined> {
    const data = await this.store.load();
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return undefined;
    const history = [...(task.history ?? []), { status, message: statusMessage, at: updatedAt }].slice(-30);
    Object.assign(task, patch, { status, statusMessage, updatedAt, history });
    await this.store.save(data);
    return task;
  }

  private queueRendererUpdate(task: Task): void {
    this.pendingUpdates.set(task.id, task);
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      const updates = [...this.pendingUpdates.values()];
      this.pendingUpdates.clear();
      if (updates.length) this.window()?.webContents.send("task:update-batch", updates);
    }, 32);
  }

  stats(): SchedulerStats { return this.scheduler.stats(); }
  async recover(): Promise<number> { return typeof this.store.recoverInterruptedTasks === "function" ? this.store.recoverInterruptedTasks() : 0; }
  async shutdown(): Promise<void> {
    this.scheduler.shutdown();
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    if (this.pendingUpdates.size) {
      this.window()?.webContents.send("task:update-batch", [...this.pendingUpdates.values()]);
      this.pendingUpdates.clear();
    }
    if (typeof this.store.flush === "function") await this.store.flush();
  }

  async start(id: string): Promise<void> {
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    const current = await this.getTask(id);
    if (!current) throw new Error("Task not found");
    const waitingForSku = waitingForLiveSku(current);
    const message = current.waitForQueue
      ? waitingForSku
        ? "Monitoring placeholder · queue handling is enabled"
        : "Monitoring official product signals · queue handling is enabled"
      : waitingForSku
        ? "Monitoring placeholder · add the live SKU when available"
        : "Monitoring official product signals";
    const task = await this.update(id, "monitoring", message, {
      queueStartedAt: undefined,
      queuePosition: undefined,
      queueEtaSeconds: undefined,
      queueLastCheckedAt: undefined,
      queueNextCheckAt: undefined,
      queueCheckIntervalMinutes: queueCheckInterval(current),
      proxyFailureCount: 0,
    });
    if (!task) throw new Error("Task not found");
    if (!waitingForSku && this.productProbe) this.scheduleProductProbe(id, 0);
  }

  async startMany(ids: string[]): Promise<void> {
    for (const id of ids) await this.start(id);
  }

  async refreshQueue(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task || task.status !== "queued") return;

    const checkedAt = new Date();
    const intervalMinutes = queueCheckInterval(task);
    const previousCheck = task.queueLastCheckedAt ? new Date(task.queueLastCheckedAt).getTime() : checkedAt.getTime();
    const elapsedSeconds = Math.max(0, Math.floor((checkedAt.getTime() - previousCheck) / 1_000));
    const queueEtaSeconds = task.queueEtaSeconds == null ? undefined : Math.max(0, task.queueEtaSeconds - elapsedSeconds);
    const position = task.queuePosition == null ? undefined : `#${task.queuePosition.toLocaleString()}`;
    const eta = queueEtaSeconds == null ? undefined : formatQueueEta(queueEtaSeconds);
    const message = position && eta
      ? `Queue position ${position} · about ${eta} remaining`
      : position
        ? `Queue position ${position} · ETA unavailable`
        : eta
          ? `About ${eta} remaining · position unavailable`
          : "Queue active · waiting for an official position or ETA";

    await this.update(id, "queued", message, {
      queueEtaSeconds,
      queueLastCheckedAt: checkedAt.toISOString(),
      queueNextCheckAt: new Date(checkedAt.getTime() + intervalMinutes * 60_000).toISOString(),
      queueCheckIntervalMinutes: intervalMinutes,
    });
    this.scheduleQueueRefresh(id, intervalMinutes);
  }

  async reportQueueState(id: string, active: boolean, position?: number, etaSeconds?: number): Promise<void> {
    const task = await this.getTask(id);
    if (!task || !task.waitForQueue) return;
    this.clear(id);
    if (!active) {
      await this.update(id, "monitoring", waitingForLiveSku(task)
        ? "No queue detected · monitoring placeholder"
        : "No queue detected · monitoring official product signals", {
        queueStartedAt: undefined,
        queuePosition: undefined,
        queueEtaSeconds: undefined,
        queueLastCheckedAt: undefined,
        queueNextCheckAt: undefined,
      });
      return;
    }
    const checkedAt = new Date();
    const intervalMinutes = queueCheckInterval(task);
    const normalizedPosition = position == null ? undefined : Math.max(1, Math.floor(position));
    const normalizedEta = etaSeconds == null ? undefined : Math.max(0, Math.floor(etaSeconds));
    const positionLabel = normalizedPosition == null ? undefined : `#${normalizedPosition.toLocaleString()}`;
    const etaLabel = normalizedEta == null ? undefined : formatQueueEta(normalizedEta);
    const message = positionLabel && etaLabel
      ? `Queue position ${positionLabel} · about ${etaLabel} remaining`
      : positionLabel
        ? `Queue position ${positionLabel} · ETA unavailable`
        : etaLabel
          ? `About ${etaLabel} remaining · position unavailable`
          : "Queue detected · waiting for an official position or ETA";
    await this.update(id, "queued", message, {
      queueStartedAt: checkedAt.toISOString(),
      queuePosition: normalizedPosition,
      queueEtaSeconds: normalizedEta,
      queueLastCheckedAt: checkedAt.toISOString(),
      queueNextCheckAt: new Date(checkedAt.getTime() + intervalMinutes * 60_000).toISOString(),
      queueCheckIntervalMinutes: intervalMinutes,
    });
    this.scheduleQueueRefresh(id, intervalMinutes);
  }

  async stop(id: string): Promise<void> {
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    await this.update(id, "stopped", "Stopped by user", { challengeStatus: undefined, challengeUrl: undefined, assignedHarvesterId: undefined });
  }
  async stopMany(ids: string[]): Promise<void> {
    for (const id of ids) await this.stop(id);
  }

  async handleProxyFailure(id: string, reason = "Proxy connection failed"): Promise<void> {
    const data = await this.store.load();
    const current = data.tasks.find((task) => task.id === id);
    if (!current) throw new Error("Task not found");

    const pool = [...new Set((current.proxyPoolIds ?? (current.proxyId ? [current.proxyId] : [])).filter(Boolean))];
    const failureCount = current.proxyFailureCount ?? 0;
    const currentIndex = pool.indexOf(current.proxyId);
    const hasUnusedProxy = pool.length > 1 && failureCount < pool.length - 1;
    if (!hasUnusedProxy) {
      this.clear(id);
      await this.update(id, "error", `${reason} - no unused selected proxies remain`, { proxyFailureCount: failureCount + 1 });
      return;
    }

    const nextProxyId = pool[(Math.max(currentIndex, 0) + 1) % pool.length]!;
    const nextProxy = data.proxies.find((proxy) => proxy.id === nextProxyId);
    const resumeStatus = current.status === "queued" ? "queued" : "monitoring";
    this.clear(id);
    await this.update(id, resumeStatus, `${reason} - switched to ${nextProxy?.name ?? "the next selected proxy"} and retrying`, {
      proxyId: nextProxyId,
      proxyFailureCount: failureCount + 1,
    });
    if (resumeStatus === "queued") this.scheduleQueueRefresh(id, queueCheckInterval(current));
  }

  async complete(id: string, outcome?: { orderNumber?: string; amount?: number; message?: string }): Promise<void> {
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    const task = await this.update(id, "completed", outcome?.message ?? "Checkout confirmed by user", {
      challengeStatus: undefined,
      challengeUrl: undefined,
      assignedHarvesterId: undefined,
      ...(outcome?.orderNumber ? { orderNumber: outcome.orderNumber } : {}),
      ...(outcome?.amount != null ? { checkoutAmount: outcome.amount } : {}),
    });
    if (task) {
      void notifyTask(this.store, task, "success").catch(() => undefined);
      void publishPublicCheckout(task).catch(() => undefined);
    }
  }
  async decline(id: string, reason?: string): Promise<void> {
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    const data = await this.store.load();
    const current = data.tasks.find((item) => item.id === id);
    const loopProfiles = current?.loopProfiles ?? current?.offerProfileFallback ?? false;
    const currentIndex = current ? data.profiles.findIndex((profile) => profile.id === current.profileId) : -1;
    const nextProfile = loopProfiles && data.profiles.length > 1 ? data.profiles[(currentIndex + 1 + data.profiles.length) % data.profiles.length] : undefined;
    const message = reason
      ? nextProfile
        ? `${reason} - ${nextProfile.name} selected for the next automatic retry`
        : reason
      : nextProfile
        ? `Checkout was declined - ${nextProfile.name} selected for the next user-confirmed retry`
        : "Checkout was declined - review the assigned profile before retrying";
    const task = await this.update(id, "declined", message, { ...(nextProfile ? { profileId: nextProfile.id } : {}), challengeStatus: undefined, challengeUrl: undefined, assignedHarvesterId: undefined });
    if (task) void notifyTask(this.store, task, "decline").catch(() => undefined);
  }
  private async declineLegacy(id: string): Promise<void> {
    this.clear(id);
    const task = await this.update(id, "declined", "Checkout was declined · choose any fallback manually before retrying");
    if (task) void notifyTask(this.store, task, "decline").catch(() => undefined);
  }
  async markCarted(id: string): Promise<void> {
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    await this.update(id, "carted", "Cart confirmed · continue checkout in the official browser", { challengeStatus: undefined, challengeUrl: undefined, assignedHarvesterId: undefined });
  }

  async applyCartLimit(id: string, maximum: number): Promise<void> {
    const task = await this.getTask(id);
    if (!task) throw new Error("Task not found");
    const resolved = resolveCartQuantity(task.quantity, maximum);
    await this.update(
      id,
      task.status,
      resolved.clamped
        ? `Store limit ${resolved.maximum} detected - quantity reduced from ${resolved.requested} to ${resolved.effective}`
        : `Store limit ${resolved.maximum} detected - quantity ${resolved.effective}`,
      cartQuantityPatch(task, maximum),
    );
  }

  async updateSku(id: string, sku: string): Promise<void> {
    const normalized = sku.trim();
    if (!normalized) throw new Error("Enter a live SKU before continuing.");
    const task = await this.getTask(id);
    if (!task) throw new Error("Task not found");
    const resumeMonitoring = ["queued", "monitoring"].includes(task.status) && waitingForLiveSku(task);
    const staysQueued = task.status === "queued";
    await this.update(id, staysQueued ? "queued" : resumeMonitoring ? "monitoring" : task.status, staysQueued ? `Live SKU ${normalized} applied - queue tracking continues` : resumeMonitoring ? `Live SKU ${normalized} applied - monitoring` : `SKU updated to ${normalized}`, { sku: normalized, usePlaceholder: false, pendingMonitorSignal: undefined });
    if (resumeMonitoring && !staysQueued) this.clear(id);
  }

  async handleProductSignal(signal: ProductSignal): Promise<void> {
    const data = await this.store.load();
    const active = data.tasks.filter((task) => ["queued", "monitoring"].includes(task.status));
    for (const task of active.filter((item) => !signal.available && item.sku?.trim().toUpperCase() === signal.sku.trim().toUpperCase())) {
      await this.update(task.id, task.status, `Product ${signal.sku} found but currently unavailable`);
    }
    const candidates = active.filter((task) => taskMatchesSignal(task, signal));
    for (const task of candidates) {
      if (task.pendingMonitorSignal?.id === signal.id) continue;
      const exactSku = !waitingForLiveSku(task) && task.sku?.trim().toUpperCase() === signal.sku.trim().toUpperCase();
      if (exactSku || task.autoApplyMonitorSignal) {
        const nextStatus = task.status === "queued" ? "queued" : "found";
        const message = task.status === "queued"
          ? `Monitor matched ${signal.sku} - queue tracking continues`
          : `Monitor matched ${signal.sku} - product signal found`;
        await this.update(task.id, nextStatus, message, { name: signal.name, sku: signal.sku, productUrl: signal.productUrl, usePlaceholder: false, pendingMonitorSignal: undefined, ...cartQuantityPatch(task, signal.maxCartQuantity) });
        if (task.status === "queued") { this.clear(task.id); continue; }
        this.clear(task.id);
        await this.requestAutoCheckout(task.id, signal.productUrl);
      } else {
        await this.update(task.id, task.status, `Monitor match ready - ${signal.sku} ${signal.name}`, { pendingMonitorSignal: signal });
      }
    }
  }

  async applyMonitorSignal(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task?.pendingMonitorSignal) throw new Error("This task has no pending monitor match.");
    const signal = task.pendingMonitorSignal;
    await this.updateSku(id, signal.sku);
    const refreshed = await this.getTask(id);
    if (!refreshed) return;
    const nextStatus = refreshed.status === "queued" ? "queued" : "found";
    await this.update(id, nextStatus, `Applied verified monitor match ${signal.sku}`, { productUrl: signal.productUrl, pendingMonitorSignal: undefined, ...cartQuantityPatch(refreshed, signal.maxCartQuantity) });
    if (nextStatus !== "queued") {
      this.clear(id);
      await this.requestAutoCheckout(id, signal.productUrl);
    }
  }

  /**
   * Auto-checkout entry point: a found task with automation enabled and a live
   * product URL hands off to the harvester/checkout pipeline instead of
   * parking silently in the Found state.
   */
  async requestAutoCheckout(id: string, productUrl: string): Promise<void> {
    if (!this.checkoutHandlers) return;
    const task = await this.getTask(id);
    if (!task || task.autoCheckout === false) return;
    if (!productUrl) {
      await this.update(id, task.status, "Automatic checkout needs a product URL - use Review to check out manually");
      return;
    }
    if (!task.profileId) {
      await this.update(id, task.status, "Automatic checkout needs a profile - assign one to this task or use Review");
      return;
    }
    this.clear(id);
    await this.update(id, "adding_to_cart", `${cartQuantityMessage(task)} · waiting for the harvester challenge to clear`, cartQuantityPatch(task, task.maxCartQuantity));
    this.scheduler.schedule(`${id}:cart-result-timeout`, cartResultTimeoutMs, () => this.expireCartAttempt(id));
    await this.challengeHandlers?.request(id, productUrl);
  }

  /** Runs the automatic checkout for a task already in adding_to_cart on the assigned harvester window. */
  async beginAutoCheckout(id: string, harvesterId: string): Promise<void> {
    if (!this.checkoutHandlers) return;
    const task = await this.getTask(id);
    if (!task || task.status !== "adding_to_cart" || task.autoCheckout === false) return;
    let outcome: CheckoutOutcome;
    try {
      const profile = (await this.store.load()).profiles.find((item) => item.id === task.profileId);
      if (!profile) throw new Error("the task has no assigned profile");
      outcome = this.checkoutHandlers
        ? await this.checkoutHandlers.run(task, profile, harvesterId)
        : { status: "declined" as const, message: "No checkout automation is wired - use Review to check out manually" };
    } catch (error) {
      outcome = { status: "declined", message: `Automatic checkout failed - ${error instanceof Error ? error.message : "unknown error"}` };
    }
    const stillRunning = await this.getTask(id);
    if (stillRunning && stillRunning.status !== "adding_to_cart") return;
    if (outcome.status === "completed") await this.complete(id, outcome);
    else await this.decline(id, outcome.message);
  }

  setCheckoutHandlers(handlers: { run: (task: Task, profile: Profile, harvesterId: string) => Promise<CheckoutOutcome> }): void {
    this.checkoutHandlers = handlers;
  }

  async review(id: string, harvesterAvailable = true): Promise<void> {
    const task = await this.getTask(id);
    if (!task) throw new Error("Task not found");
    if (this.challengeHandlers && task.challengeUrl) {
      await this.challengeHandlers.request(id, task.challengeUrl);
      return;
    }
    await this.update(
      id,
      task.status,
      harvesterAvailable
        ? "No CAPTCHA is currently assigned to this task"
        : "No CAPTCHA is waiting · create a harvester before the next challenge",
    );
  }

  async reportChallenge(id: string, challengeUrl: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) throw new Error("Task not found");
    let parsed: URL;
    try { parsed = new URL(challengeUrl); }
    catch { throw new Error("The task reported an invalid CAPTCHA URL."); }
    if (parsed.protocol !== "https:" || !["pokemoncenter.com", "www.pokemoncenter.com"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("Only an official Pokémon Center CAPTCHA can be sent to a harvester.");
    }
    await this.update(id, "awaiting_user", "CAPTCHA detected · waiting for a harvester", {
      challengeUrl,
      challengeStatus: "queued",
      assignedHarvesterId: undefined,
    });
    if (!this.challengeHandlers) return;
    await this.challengeHandlers.request(id, challengeUrl);
  }

  private async getTask(id: string): Promise<Task | undefined> {
    return typeof this.store.getTask === "function" ? this.store.getTask(id) : (await this.store.load()).tasks.find((item) => item.id === id);
  }

  private clear(id: string): void {
    this.scheduler.cancelPrefix(`${id}:`);
  }

  async reportCartAttempt(id: string, harvesterId?: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) throw new Error("Task not found");
    if (!["found", "monitoring", "queued", "awaiting_user"].includes(task.status)) {
      throw new Error(`A cart attempt cannot start while the task is ${task.status}.`);
    }
    this.clear(id);
    const assignedHarvesterId = harvesterId ?? task.assignedHarvesterId ?? "";
    await this.update(id, "adding_to_cart", cartQuantityMessage(task), cartQuantityPatch(task, task.maxCartQuantity));
    this.scheduler.schedule(`${id}:cart-result-timeout`, cartResultTimeoutMs, () => this.expireCartAttempt(id));
    await this.beginAutoCheckout(id, assignedHarvesterId);
  }

  private async expireCartAttempt(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task || task.status !== "adding_to_cart") return;
    await this.update(id, "error", "Cart attempt timed out - no cart result was received; restart the task to retry");
  }

  private scheduleProductProbe(id: string, delayMs: number): void {
    this.scheduler.schedule(`${id}:product-probe`, delayMs, () => this.probeProduct(id));
  }

  private async probeProduct(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task || !this.productProbe || !["monitoring", "queued"].includes(task.status) || waitingForLiveSku(task) || !task.sku) return;
    try {
      const signal = await this.productProbe(task.sku);
      if (signal) await this.handleProductSignal(signal);
      else await this.update(id, task.status, `No exact product match for ${task.sku} yet - monitoring`);
    } catch (error) {
      await this.update(id, task.status, `Official product check failed - ${error instanceof Error ? error.message : "retry scheduled"}`);
    }
    const refreshed = await this.getTask(id);
    if (refreshed && ["monitoring", "queued"].includes(refreshed.status)) this.scheduleProductProbe(id, productProbeIntervalMs);
  }

  private scheduleQueueRefresh(id: string, intervalMinutes: number): void {
    this.clear(id);
    this.scheduler.schedule(`${id}:queue-refresh`, intervalMinutes * 60_000, () => this.refreshQueue(id));
  }
}
