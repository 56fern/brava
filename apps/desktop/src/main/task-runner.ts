import type { BrowserWindow } from "electron";
import type { AppStore } from "./store.js";
import type { CheckoutOutcome } from "./checkout-automation.js";
import type { CheckoutStage, ProductSignal, Profile, Task, TaskStatus } from "../shared/types.js";
import { notifyTask } from "./webhook-notifier.js";
import { publishPublicCheckout } from "./public-checkout-client.js";
import { SharedScheduler, type SchedulerStats } from "./shared-scheduler.js";
import { resolveCartQuantity } from "../shared/cart-quantity.js";
import { resolvePokemonCenterProductUrl } from "../shared/product-input.js";
import type { QueueGateOutcome, QueueGateUpdate } from "./queue-gate.js";
const defaultQueueCheckIntervalMinutes = 3;
const cartResultTimeoutMs = 15_000;
const automaticCheckoutTimeoutMs = 2 * 60_000;
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
    request: (taskId: string, challengeUrl: string, preferredHarvesterId?: string) => Promise<void>;
    cancel: (taskId: string) => Promise<void>;
  } | undefined;
  private checkoutHandlers: { run: (task: Task, profile: Profile, harvesterId?: string, signal?: AbortSignal) => Promise<CheckoutOutcome> } | undefined;
  private queueHandlers: { wait: (task: Task, signal: AbortSignal, onUpdate: (update: QueueGateUpdate) => void | Promise<void>) => Promise<QueueGateOutcome> } | undefined;
  private productProbe: ((sku: string) => Promise<ProductSignal | null>) | undefined;
  private readonly operationControllers = new Map<string, AbortController>();

  constructor(
    private readonly store: AppStore,
    private readonly window: () => BrowserWindow | null,
    private readonly scheduler = new SharedScheduler(16, (key, error) => {
      const taskId = key.split(":", 1)[0];
      if (taskId) void this.update(taskId, "error", `Task engine isolated an error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }),
  ) {}

  setChallengeHandlers(handlers: {
    request: (taskId: string, challengeUrl: string, preferredHarvesterId?: string) => Promise<void>;
    cancel: (taskId: string) => Promise<void>;
  }): void {
    this.challengeHandlers = handlers;
  }

  setProductProbe(probe: (sku: string) => Promise<ProductSignal | null>): void {
    this.productProbe = probe;
  }

  setQueueHandlers(handlers: { wait: (task: Task, signal: AbortSignal, onUpdate: (update: QueueGateUpdate) => void | Promise<void>) => Promise<QueueGateOutcome> }): void {
    this.queueHandlers = handlers;
  }

  private beginOperation(id: string): AbortController {
    this.operationControllers.get(id)?.abort();
    const controller = new AbortController();
    this.operationControllers.set(id, controller);
    return controller;
  }

  private finishOperation(id: string, controller: AbortController): void {
    if (this.operationControllers.get(id) === controller) this.operationControllers.delete(id);
  }

  private cancelOperation(id: string): void {
    this.operationControllers.get(id)?.abort();
    this.operationControllers.delete(id);
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
    for (const controller of this.operationControllers.values()) controller.abort();
    this.operationControllers.clear();
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
    this.cancelOperation(id);
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    const current = await this.getTask(id);
    if (!current) throw new Error("Task not found");
    const waitingForSku = waitingForLiveSku(current);
    const message = current.waitForQueue
      ? waitingForSku
        ? "Monitoring for a live Pokémon Center queue · add the SKU before access is granted"
        : "Monitoring for a live Pokémon Center queue before opening the product"
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
      cartedAt: undefined,
    });
    if (!task) throw new Error("Task not found");
    if (task.waitForQueue) this.scheduleQueueGate(id);
    else if (!waitingForSku && this.productProbe) this.scheduleProductProbe(id, 0);
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
    this.cancelOperation(id);
    this.clear(id);
    await this.challengeHandlers?.cancel(id);
    await this.update(id, "stopped", "Stopped by user", { challengeStatus: undefined, challengeUrl: undefined, assignedHarvesterId: undefined, checkoutStage: undefined });
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
      checkoutStage: undefined,
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
    const task = await this.update(id, "declined", message, { ...(nextProfile ? { profileId: nextProfile.id } : {}), challengeStatus: undefined, challengeUrl: undefined, assignedHarvesterId: undefined, checkoutStage: undefined });
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
    await this.update(id, "carted", "Cart confirmed · continue checkout in the official browser", { challengeStatus: undefined, challengeUrl: undefined, assignedHarvesterId: undefined, checkoutStage: undefined });
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
    if (resumeMonitoring && !staysQueued && !task.waitForQueue) this.clear(id);
  }

  async handleProductSignal(signal: ProductSignal): Promise<void> {
    const productUrl = resolvePokemonCenterProductUrl(signal.productUrl, signal.sku, signal.name);
    if (!productUrl) return;
    signal = { ...signal, productUrl };
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
        if (task.waitForQueue) {
          await this.update(task.id, task.status, task.status === "queued"
            ? `Monitor matched ${signal.sku} · waiting to pass the live queue`
            : `Monitor matched ${signal.sku} · still monitoring for a live queue`, {
            name: signal.name,
            sku: signal.sku,
            productUrl: signal.productUrl,
            usePlaceholder: false,
            pendingMonitorSignal: undefined,
            ...cartQuantityPatch(task, signal.maxCartQuantity),
          });
          continue;
        }
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
    if (refreshed.waitForQueue && ["monitoring", "queued"].includes(refreshed.status)) {
      await this.update(id, refreshed.status, `Applied verified monitor match ${signal.sku} · waiting for the live queue`, { productUrl: signal.productUrl, pendingMonitorSignal: undefined, ...cartQuantityPatch(refreshed, signal.maxCartQuantity) });
      return;
    }
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
  async requestAutoCheckout(id: string, productUrl: string, harvesterId = ""): Promise<void> {
    if (!this.checkoutHandlers) return;
    const task = await this.getTask(id);
    if (!task || task.status === "stopped") return;
    const checkoutUrl = resolvePokemonCenterProductUrl(productUrl || task.productUrl, task.sku, task.name);
    if (!checkoutUrl) {
      await this.update(id, task.status, "Automatic checkout needs a product URL - use Review to check out manually");
      return;
    }
    if (!task.profileId) {
      await this.update(id, task.status, "Automatic checkout needs a profile - assign one to this task or use Review");
      return;
    }
    this.clear(id);
    await this.update(id, "adding_to_cart", `${cartQuantityMessage(task)} · automatic checkout starting`, { ...cartQuantityPatch(task, task.maxCartQuantity), productUrl: checkoutUrl, checkoutStage: "product" });
    this.scheduler.schedule(`${id}:automatic-checkout-timeout`, automaticCheckoutTimeoutMs, () => this.expireCartAttempt(id));
    await this.beginAutoCheckout(id, harvesterId);
  }

  /** Runs the automatic checkout for a task already in adding_to_cart on the assigned harvester window. */
  async beginAutoCheckout(id: string, harvesterId: string): Promise<void> {
    if (!this.checkoutHandlers) return;
    let task = await this.getTask(id);
    if (!task) return;
    if (task.status === "awaiting_user" && task.challengeStatus === "solved") {
      task = await this.update(id, task.cartedAt ? "carted" : "adding_to_cart", "CAPTCHA solved · automatic checkout resuming", { assignedHarvesterId: harvesterId }) ?? task;
    }
    if (!["adding_to_cart", "carted"].includes(task.status)) return;
    const controller = this.beginOperation(id);
    let outcome: CheckoutOutcome;
    try {
      const profile = (await this.store.load()).profiles.find((item) => item.id === task.profileId);
      if (!profile) throw new Error("the task has no assigned profile");
      outcome = this.checkoutHandlers
        ? await this.checkoutHandlers.run(task, profile, harvesterId || undefined, controller.signal)
        : { status: "declined" as const, message: "No checkout automation is wired - use Review to check out manually" };
    } catch (error) {
      outcome = controller.signal.aborted
        ? { status: "cancelled", message: "Checkout stopped by user" }
        : { status: "declined", message: `Automatic checkout failed - ${error instanceof Error ? error.message : "unknown error"}` };
    } finally {
      this.finishOperation(id, controller);
    }
    const stillRunning = await this.getTask(id);
    if (stillRunning && !["adding_to_cart", "carted", "submitting_order"].includes(stillRunning.status)) return;
    if (outcome.status === "cancelled") return;
    if (outcome.status === "captcha") {
      this.clear(id);
      await this.reportChallenge(id, outcome.challengeUrl, outcome.harvesterId || harvesterId || undefined, outcome.resumeStage);
    } else if (outcome.status === "completed") await this.complete(id, outcome);
    else await this.decline(id, outcome.message);
  }

  /** The final order control was clicked; the merchant response is still pending. */
  async markSubmittingOrder(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task || !["adding_to_cart", "carted"].includes(task.status)) return;
    const submitting = await this.update(id, "submitting_order", "Place Order clicked · waiting for Pokémon Center confirmation", { checkoutStage: "confirmation" });
    // Do not let the normal 32 ms update coalescing swallow this short-lived
    // status when the merchant confirms an order immediately.
    if (submitting) {
      this.pendingUpdates.delete(id);
      this.window()?.webContents.send("task:update-batch", [submitting]);
    }
  }

  async markAutomaticCarted(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task || task.status !== "adding_to_cart" || task.cartedAt) return;
    const carted = await this.update(id, "carted", "Cart confirmed · continuing checkout", { cartedAt: new Date().toISOString(), checkoutStage: "cart" });
    if (carted) {
      this.pendingUpdates.delete(id);
      this.window()?.webContents.send("task:update-batch", [carted]);
    }
  }

  setCheckoutHandlers(handlers: { run: (task: Task, profile: Profile, harvesterId?: string, signal?: AbortSignal) => Promise<CheckoutOutcome> }): void {
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

  async reportChallenge(id: string, challengeUrl: string, preferredHarvesterId?: string, checkoutStage?: CheckoutStage): Promise<void> {
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
      ...(checkoutStage ? { checkoutStage } : {}),
    });
    if (!this.challengeHandlers) return;
    if (preferredHarvesterId) await this.challengeHandlers.request(id, challengeUrl, preferredHarvesterId);
    else await this.challengeHandlers.request(id, challengeUrl);
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
    if (!task || !["adding_to_cart", "carted", "submitting_order"].includes(task.status)) return;
    await this.update(id, "error", task.status === "submitting_order"
      ? "Order confirmation timed out - verify the order before retrying"
      : "Cart attempt timed out - no cart result was received; restart the task to retry");
  }

  private scheduleQueueGate(id: string): void {
    this.scheduler.schedule(`${id}:queue-gate`, 0, () => this.runQueueGate(id));
  }

  private async runQueueGate(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task || !task.waitForQueue || task.status !== "monitoring") return;
    if (!this.queueHandlers) {
      await this.update(id, "error", "Queue monitoring is unavailable; restart Brava and try again.");
      return;
    }
    const controller = this.beginOperation(id);
    let outcome: QueueGateOutcome;
    try {
      outcome = await this.queueHandlers.wait(task, controller.signal, async (queue) => {
        const current = await this.getTask(id);
        if (!current || controller.signal.aborted || !current.waitForQueue || !["monitoring", "queued"].includes(current.status)) return;
        if (!queue.active) {
          await this.update(id, "monitoring", "No queue is live yet · monitoring Pokémon Center", {
            queueStartedAt: undefined,
            queuePosition: undefined,
            queueEtaSeconds: undefined,
            queueLastCheckedAt: new Date().toISOString(),
            queueNextCheckAt: undefined,
          });
          return;
        }
        const checkedAt = new Date().toISOString();
        await this.update(id, "queued", "Queue is live · waiting for Pokémon Center access", {
          queueStartedAt: current.queueStartedAt ?? checkedAt,
          queuePosition: queue.position,
          queueEtaSeconds: queue.etaSeconds,
          queueLastCheckedAt: checkedAt,
          queueNextCheckAt: undefined,
        });
      });
    } catch (error) {
      outcome = controller.signal.aborted
        ? { status: "cancelled" }
        : { status: "failed", message: `Queue monitoring failed - ${error instanceof Error ? error.message : "unknown error"}` };
    } finally {
      this.finishOperation(id, controller);
    }
    if (outcome.status === "cancelled") return;
    const current = await this.getTask(id);
    if (!current || !current.waitForQueue || !["monitoring", "queued"].includes(current.status)) return;
    if (outcome.status === "failed") {
      await this.update(id, "error", outcome.message);
      return;
    }
    if (waitingForLiveSku(current)) {
      await this.update(id, "error", "Queue passed, but this task has no live SKU to open.");
      return;
    }
    const productUrl = resolvePokemonCenterProductUrl(current.productUrl, current.sku, current.name);
    if (!productUrl) {
      await this.update(id, "error", "Queue passed, but Brava could not build the Pokémon Center product URL.");
      return;
    }
    await this.update(id, "found", "Queue passed · opening the task product", {
      queuePosition: undefined,
      queueEtaSeconds: undefined,
      queueLastCheckedAt: new Date().toISOString(),
      queueNextCheckAt: undefined,
      productUrl,
    });
    await this.requestAutoCheckout(id, productUrl, outcome.harvesterId);
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
