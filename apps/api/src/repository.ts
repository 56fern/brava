import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Database,
  DeviceResetResult,
  License,
  LicenseActivationInput,
  LicenseActivationResult,
} from "./types.js";

export interface LicenseStore {
  ping(): Promise<void>;
  createLicense(license: License): Promise<void>;
  activateDevice(input: LicenseActivationInput): Promise<LicenseActivationResult>;
  isActiveDevice(licenseId: string, deviceId: string): Promise<boolean>;
  heartbeatDevice(licenseId: string, deviceId: string, now: Date): Promise<boolean>;
  deactivateDevice(licenseId: string, deviceId: string): Promise<boolean>;
  resetLicenseDevices(licenseId: string): Promise<DeviceResetResult | null>;
  resetDevicesBySelector(selector: string): Promise<DeviceResetResult | null>;
  close(): Promise<void>;
}

export class LicenseRepository implements LicenseStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<Database> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { licenses: [] };
    }
  }

  async mutate<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const database = await this.read();
      const result = await operation(database);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(database, null, 2), "utf8");
      await rename(temporary, this.filePath);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async findByHash(keyHash: string): Promise<License | undefined> {
    return (await this.read()).licenses.find((license) => license.keyHash === keyHash);
  }

  async ping(): Promise<void> { await this.read(); }

  async createLicense(license: License): Promise<void> {
    await this.mutate((database) => { database.licenses.push(license); });
  }

  async activateDevice(input: LicenseActivationInput): Promise<LicenseActivationResult> {
    return this.mutate((database) => {
      const license = database.licenses.find((item) => item.keyHash === input.keyHash);
      if (!license || license.status !== "active") return { ok: false, error: "invalid_license" };
      if (license.expiresAt && new Date(license.expiresAt).getTime() <= input.now.getTime()) {
        return { ok: false, error: "expired_license" };
      }
      let device = license.devices.find((item) => item.deviceId === input.deviceId);
      if (!device && license.maxDevices !== null && license.devices.length >= license.maxDevices) {
        return { ok: false, error: "device_limit" };
      }
      const now = input.now.toISOString();
      if (device) {
        device.deviceName = input.deviceName;
        device.lastSeenAt = now;
      } else {
        device = { deviceId: input.deviceId, deviceName: input.deviceName, activatedAt: now, lastSeenAt: now };
        license.devices.push(device);
      }
      return { ok: true, licenseId: license.id, label: license.label, expiresAt: license.expiresAt };
    });
  }

  async isActiveDevice(licenseId: string, deviceId: string): Promise<boolean> {
    const license = (await this.read()).licenses.find((item) => item.id === licenseId);
    return Boolean(license?.status === "active" && license.devices.some((device) => device.deviceId === deviceId));
  }

  async heartbeatDevice(licenseId: string, deviceId: string, now: Date): Promise<boolean> {
    return this.mutate((database) => {
      const license = database.licenses.find((item) => item.id === licenseId);
      const device = license?.devices.find((item) => item.deviceId === deviceId);
      if (!license || !device || license.status !== "active") return false;
      device.lastSeenAt = now.toISOString();
      return true;
    });
  }

  async deactivateDevice(licenseId: string, deviceId: string): Promise<boolean> {
    return this.mutate((database) => {
      const license = database.licenses.find((item) => item.id === licenseId);
      if (!license || license.status !== "active") return false;
      const before = license.devices.length;
      license.devices = license.devices.filter((item) => item.deviceId !== deviceId);
      return license.devices.length < before;
    });
  }

  async resetLicenseDevices(licenseId: string): Promise<DeviceResetResult | null> {
    return this.mutate((database) => {
      const license = database.licenses.find((item) => item.id === licenseId);
      if (!license) return null;
      const removed = license.devices.length;
      license.devices = [];
      return { removed, licenseId: license.id, label: license.label };
    });
  }

  async resetDevicesBySelector(selector: string): Promise<DeviceResetResult | null> {
    return this.mutate((database) => {
      const license = database.licenses.find((item) => item.id === selector || item.label.toLowerCase() === selector.toLowerCase());
      if (!license) return null;
      const removed = license.devices.length;
      license.devices = [];
      return { removed, licenseId: license.id, label: license.label };
    });
  }

  async close(): Promise<void> {}
}
