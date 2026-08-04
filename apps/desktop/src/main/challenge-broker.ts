import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { AppStore } from "./store.js";
import type { Harvester, Task } from "../shared/types.js";

export type ChallengeRequestStatus = "queued" | "assigned" | "solved" | "cancelled";

export type ChallengeRequest = {
  id: string;
  taskId: string;
  status: ChallengeRequestStatus;
  priority: number;
  createdAt: string;
  expiresAt?: string;
  assignedHarvesterId?: string;
  attempts: number;
  testMode: boolean;
  challengeUrl?: string;
};

export type ChallengeBrokerSnapshot = {
  queued: number;
  assigned: number;
  testMode: boolean;
  requests: ChallengeRequest[];
};

export type ChallengeHarvesterPort = {
  open: (harvesterId: string) => Promise<void>;
  assign: (harvesterId: string, requestId: string, taskId: string, taskName: string, challengeUrl: string) => Promise<void>;
  release: (harvesterId: string, message: string) => Promise<void>;
  incrementSolved: (harvesterId: string) => Promise<void>;
};

type BrokerOptions = {
  testMode?: boolean;
  leaseMs?: number;
  testDelayMs?: number;
  now?: () => Date;
};

const isActive = (request: ChallengeRequest) => request.status === "queued" || request.status === "assigned";
const isOfficialChallengeUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["pokemoncenter.com", "www.pokemoncenter.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

export class ChallengeBroker {
  private readonly requests: ChallengeRequest[] = [];
  private readonly testMode: boolean;
  private readonly leaseMs: number;
  private readonly testDelayMs: number;
  private readonly now: () => Date;
  private operations: Promise<void> = Promise.resolve();
  private expiryTimer: NodeJS.Timeout | undefined;
  private testTimer: NodeJS.Timeout | undefined;
  private testActiveId: string | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly window: () => BrowserWindow | null,
    private readonly harvesters: ChallengeHarvesterPort,
    options: BrokerOptions = {},
  ) {
    this.testMode = options.testMode === true;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    this.testDelayMs = options.testDelayMs ?? 350;
    this.now = options.now ?? (() => new Date());
  }

  snapshot(): ChallengeBrokerSnapshot {
    return {
      queued: this.requests.filter((request) => request.status === "queued").length,
      assigned: this.requests.filter((request) => request.status === "assigned").length,
      testMode: this.testMode,
      requests: this.requests.map((request) => ({ ...request })),
    };
  }

  async recover(): Promise<void> {
    return this.run(async () => {
      const data = await this.store.load();
      for (const harvester of data.harvesters.filter((item) => item.assignedRequestId || item.assignedTaskId || item.status === "busy")) {
        await this.harvesters.release(harvester.id, "Recovered after restart · ready");
      }
      for (const task of data.tasks) {
        if (task.status !== "awaiting_user" || task.challengeStatus === "solved" || !isOfficialChallengeUrl(task.challengeUrl)) continue;
        const request: ChallengeRequest = {
          id: task.challengeRequestId ?? randomUUID(),
          taskId: task.id,
          status: "queued",
          priority: 0,
          createdAt: task.challengeRequestedAt ?? this.now().toISOString(),
          attempts: task.challengeAttempts ?? 0,
          testMode: this.testMode,
          challengeUrl: task.challengeUrl,
        };
        if (!this.requests.some((item) => item.taskId === task.id && isActive(item))) this.requests.push(request);
        await this.patchTask(task.id, "Challenge restored after restart · waiting for a harvester", {
          challengeRequestId: request.id,
          challengeStatus: "queued",
          assignedHarvesterId: undefined,
          challengeRequestedAt: request.createdAt,
          challengeAttempts: request.attempts,
        });
      }
      await this.dispatchInternal();
    });
  }

  async request(taskId: string, priority = 0, challengeUrl?: string): Promise<void> {
    return this.run(async () => {
      const existing = this.requests.find((request) => request.taskId === taskId && isActive(request));
      if (existing) {
        if (existing.assignedHarvesterId && existing.assignedHarvesterId !== "__test__") await this.harvesters.open(existing.assignedHarvesterId);
        return;
      }
      const task = await this.getTask(taskId);
      if (!task) throw new Error("Task not found");
      if (!this.testMode && !isOfficialChallengeUrl(challengeUrl)) throw new Error("A real Pokémon Center CAPTCHA URL is required before a harvester can be assigned.");
      const createdAt = this.now().toISOString();
      const request: ChallengeRequest = { id: randomUUID(), taskId, status: "queued", priority, createdAt, attempts: 0, testMode: this.testMode, challengeUrl };
      this.requests.push(request);
      await this.patchTask(taskId, this.testMode ? "Development challenge queued" : "Challenge queued · waiting for a harvester", {
        challengeRequestId: request.id,
        challengeStatus: "queued",
        assignedHarvesterId: undefined,
        challengeRequestedAt: createdAt,
        challengeAttempts: 0,
        challengeUrl,
      });
      await this.dispatchInternal();
    });
  }

  async solve(harvesterId: string): Promise<void> {
    return this.run(async () => {
      const request = this.requests.find((item) => item.status === "assigned" && item.assignedHarvesterId === harvesterId);
      if (!request) throw new Error("This harvester has no assigned challenge.");
      request.status = "solved";
      request.expiresAt = undefined;
      request.assignedHarvesterId = undefined;
      await this.patchTask(request.taskId, "Challenge solved by user · continue checkout in the official window", {
        challengeStatus: "solved",
        assignedHarvesterId: undefined,
        challengeUrl: undefined,
      });
      await this.harvesters.incrementSolved(harvesterId);
      await this.harvesters.release(harvesterId, "Ready for the next challenge");
      this.emit();
      await this.dispatchInternal();
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    return this.run(async () => {
      const request = this.requests.find((item) => item.taskId === taskId && isActive(item));
      if (!request) return;
      const harvesterId = request.assignedHarvesterId;
      request.status = "cancelled";
      request.expiresAt = undefined;
      request.assignedHarvesterId = undefined;
      if (harvesterId && harvesterId !== "__test__") await this.harvesters.release(harvesterId, "Assignment cancelled · ready");
      if (this.testActiveId === request.id) this.testActiveId = undefined;
      this.emit();
      await this.dispatchInternal();
    });
  }

  async releaseHarvester(harvesterId: string, redistribute = true): Promise<void> {
    return this.run(async () => {
      const request = this.requests.find((item) => item.status === "assigned" && item.assignedHarvesterId === harvesterId);
      if (!request) {
        if (redistribute) await this.dispatchInternal();
        return;
      }
      request.status = "queued";
      request.assignedHarvesterId = undefined;
      request.expiresAt = undefined;
      request.attempts += 1;
      await this.patchTask(request.taskId, "Harvester closed · challenge requeued", {
        challengeStatus: "queued",
        assignedHarvesterId: undefined,
        challengeAttempts: request.attempts,
      });
      this.emit();
      if (redistribute) await this.dispatchInternal(harvesterId);
    });
  }

  async dispatch(): Promise<void> { return this.run(() => this.dispatchInternal()); }

  shutdown(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.testTimer) clearTimeout(this.testTimer);
    this.expiryTimer = undefined;
    this.testTimer = undefined;
  }

  private run(operation: () => Promise<void>): Promise<void> {
    const result = this.operations.then(operation);
    this.operations = result.then(() => undefined, () => undefined);
    return result;
  }

  private async dispatchInternal(excludedHarvesterId?: string): Promise<void> {
    await this.requeueExpired();
    const next = () => this.requests
      .filter((request) => request.status === "queued")
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];

    if (this.testMode) {
      if (this.testActiveId) return;
      const request = next();
      if (!request) { this.emit(); return; }
      request.status = "assigned";
      request.assignedHarvesterId = "__test__";
      request.expiresAt = new Date(this.now().getTime() + this.leaseMs).toISOString();
      this.testActiveId = request.id;
      await this.patchTask(request.taskId, "Development test challenge running", { challengeStatus: "assigned", assignedHarvesterId: undefined });
      this.emit();
      this.testTimer = setTimeout(() => void this.run(() => this.completeTest(request.id)), this.testDelayMs);
      this.scheduleExpiry();
      return;
    }

    const data = await this.store.load();
    const assignedIds = new Set(this.requests.filter((request) => request.status === "assigned").map((request) => request.assignedHarvesterId));
    const available = data.harvesters.filter((harvester) => harvester.id !== excludedHarvesterId && harvester.status !== "error" && !assignedIds.has(harvester.id) && !harvester.assignedRequestId);
    for (const harvester of available) {
      const request = next();
      if (!request) break;
      const task = data.tasks.find((item) => item.id === request.taskId);
      if (!task) { request.status = "cancelled"; continue; }
      request.status = "assigned";
      request.assignedHarvesterId = harvester.id;
      request.expiresAt = new Date(this.now().getTime() + this.leaseMs).toISOString();
      await this.patchTask(task.id, `Challenge assigned to ${harvester.name} · solve it manually`, { challengeStatus: "assigned", assignedHarvesterId: harvester.id, challengeAttempts: request.attempts });
      if (!request.challengeUrl) { request.status = "cancelled"; continue; }
      await this.harvesters.assign(harvester.id, request.id, task.id, task.name, request.challengeUrl);
      try { await this.harvesters.open(harvester.id); }
      catch {
        request.status = "queued";
        request.assignedHarvesterId = undefined;
        request.expiresAt = undefined;
        request.attempts += 1;
        await this.harvesters.release(harvester.id, "Unable to open · assignment requeued");
      }
    }
    this.emit();
    this.scheduleExpiry();
  }

  private async completeTest(id: string): Promise<void> {
    const request = this.requests.find((item) => item.id === id && item.status === "assigned" && item.assignedHarvesterId === "__test__");
    if (!request) return;
    request.status = "solved";
    request.assignedHarvesterId = undefined;
    request.expiresAt = undefined;
    this.testActiveId = undefined;
    await this.patchTask(request.taskId, "Development test challenge completed", { challengeStatus: "solved", assignedHarvesterId: undefined });
    this.emit();
    await this.dispatchInternal();
  }

  private async requeueExpired(): Promise<void> {
    const now = this.now().getTime();
    for (const request of this.requests.filter((item) => item.status === "assigned" && item.expiresAt && new Date(item.expiresAt).getTime() <= now)) {
      const harvesterId = request.assignedHarvesterId;
      request.status = "queued";
      request.assignedHarvesterId = undefined;
      request.expiresAt = undefined;
      request.attempts += 1;
      if (this.testActiveId === request.id) this.testActiveId = undefined;
      if (harvesterId && harvesterId !== "__test__") await this.harvesters.release(harvesterId, "Assignment expired · ready");
      await this.patchTask(request.taskId, "Challenge assignment expired · requeued", { challengeStatus: "queued", assignedHarvesterId: undefined, challengeAttempts: request.attempts });
    }
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const nextExpiry = this.requests.filter((request) => request.status === "assigned" && request.expiresAt).map((request) => new Date(request.expiresAt!).getTime()).sort((a, b) => a - b)[0];
    if (nextExpiry == null) { this.expiryTimer = undefined; return; }
    this.expiryTimer = setTimeout(() => void this.run(() => this.dispatchInternal()), Math.max(1, nextExpiry - this.now().getTime()));
  }

  private emit(): void {
    this.window()?.webContents.send("challenge:state", this.snapshot());
  }

  private async getTask(id: string): Promise<Task | undefined> {
    return typeof this.store.getTask === "function" ? this.store.getTask(id) : (await this.store.load()).tasks.find((task) => task.id === id);
  }

  private async patchTask(id: string, message: string, patch: Partial<Task>): Promise<void> {
    const at = this.now().toISOString();
    const mutate = (task: Task) => {
      task.status = "awaiting_user";
      task.statusMessage = message;
      task.updatedAt = at;
      task.history = [...(task.history ?? []), { status: "awaiting_user" as const, message, at }].slice(-30);
      Object.assign(task, patch);
    };
    const task = typeof this.store.updateTask === "function"
      ? await this.store.updateTask(id, mutate)
      : await (async () => {
          const data = await this.store.load();
          const current = data.tasks.find((item) => item.id === id);
          if (!current) return undefined;
          mutate(current);
          await this.store.save(data);
          return current;
        })();
    if (task) this.window()?.webContents.send("task:update-batch", [task]);
  }
}
