import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppData, Harvester, Profile, ProxyConfig, ResourceGroup, Task, TaskGroup, WebhookSettings } from "../shared/types.js";

type DiskData = {
  deviceId: string;
  licenseKey?: string;
  webhookSettings?: string;
  profileGroups: ResourceGroup[];
  proxyGroups: ResourceGroup[];
  profiles: string[];
  proxies: string[];
  taskGroups: TaskGroup[];
  tasks: Task[];
  harvesters: Array<Harvester | string>;
};

const defaults = (): DiskData => ({ deviceId: randomUUID(), profileGroups: [], proxyGroups: [], profiles: [], proxies: [], taskGroups: [], tasks: [], harvesters: [] });
const migratedGroup = (): TaskGroup => ({ id: "pokemon-center-migrated", name: "Pokémon Center", site: "pokemon_center_us" });
const defaultWebhookSettings = (): WebhookSettings => ({ successUrl: "", declineUrl: "", successEnabled: true, declineEnabled: true });
const requireEncryption = () => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable. Restart Brava outside a restricted environment.");
  }
};
const encrypt = (value: unknown) => {
  requireEncryption();
  return safeStorage.encryptString(JSON.stringify(value)).toString("base64");
};
const decrypt = <T>(value: string): T => {
  requireEncryption();
  return JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64"))) as T;
};

export class AppStore {
  private readonly path = join(app.getPath("userData"), "brava-data.json");
  private readonly legacyPaths = [
    join(app.getPath("userData"), "car" + "dinal-data.json"),
    join(app.getPath("appData"), "@car" + "dinal", "desktop", "car" + "dinal-data.json"),
  ];
  private cache: DiskData | undefined;
  private readonly taskIndex = new Map<string, Task>();
  private operations: Promise<void> = Promise.resolve();
  private writeTimer: NodeJS.Timeout | undefined;
  private dirty = false;

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readDisk(): Promise<DiskData> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as DiskData;
      return { ...defaults(), ...parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      for (const legacyPath of this.legacyPaths) {
        try {
          const migrated = { ...defaults(), ...JSON.parse(await readFile(legacyPath, "utf8")) as DiskData };
          await this.writeDisk(migrated);
          return migrated;
        } catch (legacyError) {
          if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
        }
      }
      const initial = defaults();
      await this.writeDisk(initial);
      return initial;
    }
  }

  private async writeDisk(data: DiskData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await rename(temporary, this.path);
  }

  private async disk(): Promise<DiskData> {
    if (!this.cache) {
      this.cache = await this.readDisk();
      this.reindexTasks();
    }
    return this.cache;
  }

  private reindexTasks(): void {
    this.taskIndex.clear();
    for (const task of this.cache?.tasks ?? []) this.taskIndex.set(task.id, task);
  }

  private checkpointSoon(): void {
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.flush();
    }, 40);
  }

  async flush(): Promise<void> {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    await this.exclusive(async () => {
      if (!this.dirty || !this.cache) return;
      const snapshot = structuredClone(this.cache);
      this.dirty = false;
      try {
        await this.writeDisk(snapshot);
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    });
  }

  async load(): Promise<AppData> {
    const disk = await this.exclusive(() => this.disk());
    const taskGroups = disk.taskGroups.length ? disk.taskGroups : disk.tasks.length ? [migratedGroup()] : [];
    const profiles = disk.profiles.map((value) => decrypt<Profile>(value));
    const proxies = disk.proxies.map((value) => decrypt<ProxyConfig>(value));
    const profileGroups = disk.profileGroups.length ? disk.profileGroups : profiles.length ? [{ id: "profile-group-imported", name: "Imported" }] : [];
    const proxyGroups = disk.proxyGroups.length ? disk.proxyGroups : proxies.length ? [{ id: "proxy-group-imported", name: "Imported" }] : [];
    return {
      profileGroups,
      proxyGroups,
      profiles: profiles.map((value) => ({ ...value, groupId: value.groupId ?? profileGroups[0]?.id })),
      proxies: proxies.map((value) => ({ ...value, groupId: value.groupId ?? proxyGroups[0]?.id })),
      taskGroups,
      tasks: disk.tasks.map((task) => {
        const loopProfiles = task.loopProfiles ?? task.offerProfileFallback ?? false;
        const { offerProxyFallback: _legacyProxyFallback, ...current } = task as Task & { offerProxyFallback?: boolean };
        const proxyPoolIds = current.proxyPoolIds ?? (current.proxyId ? [current.proxyId] : []);
        return { ...current, groupId: current.groupId ?? taskGroups[0]?.id, waitForQueue: current.waitForQueue ?? false, monitorKeywords: current.monitorKeywords ?? current.name, autoApplyMonitorSignal: current.autoApplyMonitorSignal ?? false, loopProfiles, offerProfileFallback: loopProfiles, proxyPoolIds };
      }),
      harvesters: disk.harvesters.map((value) => {
        const harvester = typeof value === "string" ? decrypt<Harvester>(value) : value;
        return { ...harvester, proxy: harvester.proxy ?? "" };
      }),
    };
  }

  async save(data: AppData): Promise<AppData> {
    return this.exclusive(async () => {
      const disk = await this.disk();
      this.cache = { ...disk, profileGroups: structuredClone(data.profileGroups), proxyGroups: structuredClone(data.proxyGroups), profiles: data.profiles.map(encrypt), proxies: data.proxies.map(encrypt), taskGroups: structuredClone(data.taskGroups), tasks: structuredClone(data.tasks), harvesters: data.harvesters.map(encrypt) };
      this.reindexTasks();
      this.checkpointSoon();
      return structuredClone(data);
    });
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.exclusive(async () => {
      await this.disk();
      const task = this.taskIndex.get(id);
      return task ? structuredClone(task) : undefined;
    });
  }

  async updateTask(id: string, mutate: (task: Task) => void): Promise<Task | undefined> {
    return this.exclusive(async () => {
      await this.disk();
      const task = this.taskIndex.get(id);
      if (!task) return undefined;
      mutate(task);
      this.checkpointSoon();
      return structuredClone(task);
    });
  }

  async updateHarvester(id: string, mutate: (harvester: Harvester) => void): Promise<Harvester | undefined> {
    return this.exclusive(async () => {
      const disk = await this.disk();
      const index = disk.harvesters.findIndex((value) => {
        const harvester = typeof value === "string" ? decrypt<Harvester>(value) : value;
        return harvester.id === id;
      });
      if (index < 0) return undefined;
      const stored = disk.harvesters[index]!;
      const harvester = typeof stored === "string" ? decrypt<Harvester>(stored) : structuredClone(stored);
      mutate(harvester);
      disk.harvesters[index] = encrypt(harvester);
      this.checkpointSoon();
      return structuredClone(harvester);
    });
  }

  async recoverInterruptedTasks(): Promise<number> {
    return this.exclusive(async () => {
      const disk = await this.disk();
      const interrupted = new Set(["queued", "monitoring", "found", "adding_to_cart"]);
      const at = new Date().toISOString();
      let recovered = 0;
      for (const task of disk.tasks) {
        if (!interrupted.has(task.status)) continue;
        task.status = "stopped";
        task.statusMessage = "Recovered after Brava restarted - start this task when ready";
        task.updatedAt = at;
        task.history = [...(task.history ?? []), { status: "stopped" as const, message: task.statusMessage, at }].slice(-30);
        recovered += 1;
      }
      if (recovered) this.checkpointSoon();
      return recovered;
    });
  }

  async getDeviceId(): Promise<string> { return this.exclusive(async () => (await this.disk()).deviceId); }
  async getLicenseKey(): Promise<string | null> {
    const value = await this.exclusive(async () => (await this.disk()).licenseKey);
    return value && safeStorage.isEncryptionAvailable() ? decrypt<string>(value) : null;
  }
  async setLicenseKey(key: string): Promise<void> {
    await this.exclusive(async () => { const disk = await this.disk(); disk.licenseKey = encrypt(key); this.checkpointSoon(); });
  }
  async clearLicenseKey(): Promise<void> {
    await this.exclusive(async () => { const disk = await this.disk(); delete disk.licenseKey; this.checkpointSoon(); });
  }
  async getWebhookSettings(): Promise<WebhookSettings> {
    const value = await this.exclusive(async () => (await this.disk()).webhookSettings);
    return value ? { ...defaultWebhookSettings(), ...decrypt<WebhookSettings>(value) } : defaultWebhookSettings();
  }
  async setWebhookSettings(settings: WebhookSettings): Promise<WebhookSettings> {
    const normalized: WebhookSettings = {
      successUrl: settings.successUrl.trim(),
      declineUrl: settings.declineUrl.trim(),
      successEnabled: settings.successEnabled,
      declineEnabled: settings.declineEnabled,
    };
    await this.exclusive(async () => { const disk = await this.disk(); disk.webhookSettings = encrypt(normalized); this.checkpointSoon(); });
    return normalized;
  }
}
