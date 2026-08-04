import { hostname } from "node:os";
import type { LicenseSession } from "../shared/types.js";
import type { AppStore } from "./store.js";

let activeToken: string | null = null;
let activeApiUrl: string | null = null;

export function serverEndpoint(apiUrl: string, path: string): string {
  const url = new URL(path, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  const localDevelopment = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) throw new Error("The license server must use HTTPS.");
  return url.toString();
}

export async function activate(store: AppStore, key: string, apiUrl: string): Promise<LicenseSession> {
  const response = await fetch(serverEndpoint(apiUrl, "v1/licenses/activate"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, deviceId: await store.getDeviceId(), deviceName: hostname() }),
  });
  const result = await response.json() as { token?: string; license?: LicenseSession; error?: string };
  if (!response.ok || !result.token || !result.license) {
    const messages: Record<string, string> = {
      device_limit: "This key is already active on its allowed number of devices. Deactivate the old device or ask the license administrator to reset it.",
      invalid_license: "This license key is invalid or has been revoked.",
      expired_license: "This license key has expired.",
    };
    throw new Error(result.error ? messages[result.error] ?? result.error.replaceAll("_", " ") : "Activation failed");
  }
  activeToken = result.token;
  activeApiUrl = apiUrl;
  await store.setLicenseKey(key);
  return result.license;
}

export async function resume(store: AppStore, apiUrl: string): Promise<LicenseSession | null> {
  const key = await store.getLicenseKey();
  return key ? activate(store, key, apiUrl) : null;
}

export async function heartbeat(apiUrl: string): Promise<boolean> {
  if (!activeToken) return false;
  try {
    const response = await fetch(serverEndpoint(apiUrl, "v1/licenses/heartbeat"), {
      method: "POST", headers: { authorization: `Bearer ${activeToken}` },
    });
    const result = await response.json() as { token?: string };
    if (!response.ok || !result.token) { activeToken = null; activeApiUrl = null; return false; }
    activeToken = result.token;
    return true;
  } catch {
    return false;
  }
}

export async function deactivate(store: AppStore, apiUrl: string): Promise<void> {
  if (!activeToken) throw new Error("No active license session was found.");
  const response = await fetch(serverEndpoint(apiUrl, "v1/licenses/device"), {
    method: "DELETE",
    headers: { authorization: `Bearer ${activeToken}` },
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error?.replaceAll("_", " ") ?? "Could not deactivate this device");
  activeToken = null;
  activeApiUrl = null;
  await store.clearLicenseKey();
}

export function activeLicenseToken(): string | null { return activeToken; }
export function activeLicenseApiUrl(): string | null { return activeApiUrl; }
