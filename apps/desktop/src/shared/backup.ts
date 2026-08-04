import type { AppData, Harvester, Profile, ProxyConfig, ResourceGroup, Task, TaskGroup, TaskStatus } from "./types.js";

const taskStatuses = new Set<TaskStatus>(["idle", "queued", "monitoring", "found", "adding_to_cart", "carted", "awaiting_user", "completed", "declined", "stopped", "error"]);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Backup contains an invalid record.");
  return value as Record<string, unknown>;
};
const text = (record: Record<string, unknown>, key: string, optional = false): string => {
  const value = record[key];
  if (optional && value == null) return "";
  if (typeof value !== "string") throw new Error(`Backup field ${key} must be text.`);
  return value;
};
const number = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Backup field ${key} must be a number.`);
  return value;
};

function profile(value: unknown): Profile {
  const item = object(value);
  const paymentValue = item.payment;
  let payment: Profile["payment"];
  if (paymentValue != null) {
    const card = object(paymentValue);
    const brand = text(card, "brand");
    if (!["Visa", "Mastercard", "Amex", "Discover", "Other"].includes(brand)) throw new Error("Backup contains an unsupported card brand.");
    payment = { cardholderName: text(card, "cardholderName"), brand: brand as NonNullable<Profile["payment"]>["brand"], last4: text(card, "last4"), expiryMonth: text(card, "expiryMonth"), expiryYear: text(card, "expiryYear"), billingSameAsShipping: Boolean(card.billingSameAsShipping) };
  }
  const billingValue = item.billing;
  let billing: Profile["billing"];
  if (billingValue != null) {
    const address = object(billingValue);
    billing = { firstName: text(address, "firstName", true), lastName: text(address, "lastName", true), address1: text(address, "address1", true), address2: text(address, "address2", true), city: text(address, "city", true), region: text(address, "region", true), postalCode: text(address, "postalCode", true), country: text(address, "country", true) };
  }
  return { id: text(item, "id"), groupId: text(item, "groupId", true) || undefined, name: text(item, "name"), email: text(item, "email"), firstName: text(item, "firstName"), lastName: text(item, "lastName"), address1: text(item, "address1"), address2: text(item, "address2", true), city: text(item, "city"), region: text(item, "region"), postalCode: text(item, "postalCode"), country: text(item, "country"), phone: text(item, "phone"), payment, billing };
}

function proxy(value: unknown): ProxyConfig {
  const item = object(value);
  const protocol = text(item, "protocol");
  if (protocol !== "http" && protocol !== "https") throw new Error("Backup contains an unsupported proxy protocol.");
  const port = number(item, "port");
  if (port < 1 || port > 65535) throw new Error("Backup contains an invalid proxy port.");
  return { id: text(item, "id"), groupId: text(item, "groupId", true) || undefined, name: text(item, "name"), protocol, host: text(item, "host"), port, username: text(item, "username", true), password: text(item, "password", true) };
}

function resourceGroup(value: unknown): ResourceGroup {
  const item = object(value);
  return { id: text(item, "id"), name: text(item, "name") };
}

function task(value: unknown): Task {
  const item = object(value);
  const status = text(item, "status") as TaskStatus;
  if (!taskStatuses.has(status)) throw new Error("Backup contains an unsupported task status.");
  return { ...item, id: text(item, "id"), name: text(item, "name"), productUrl: text(item, "productUrl", true), variant: text(item, "variant", true), quantity: number(item, "quantity"), profileId: text(item, "profileId", true), proxyId: text(item, "proxyId", true), status, statusMessage: text(item, "statusMessage"), updatedAt: text(item, "updatedAt") } as Task;
}

function taskGroup(value: unknown): TaskGroup {
  const item = object(value);
  const site = text(item, "site");
  if (site !== "pokemon_center_us") throw new Error("Backup contains an unsupported task-group site.");
  return { id: text(item, "id"), name: text(item, "name"), site };
}

function harvester(value: unknown): Harvester {
  const item = object(value);
  const status = text(item, "status");
  if (!["idle", "opening", "open", "busy", "closed", "error"].includes(status)) throw new Error("Backup contains an unsupported harvester status.");
  return { id: text(item, "id"), name: text(item, "name"), proxy: text(item, "proxy", true), status: status as Harvester["status"], statusMessage: text(item, "statusMessage"), solveCount: number(item, "solveCount"), assignedRequestId: text(item, "assignedRequestId", true) || undefined, assignedTaskId: text(item, "assignedTaskId", true) || undefined, openOnLaunch: Boolean(item.openOnLaunch), createdAt: text(item, "createdAt"), updatedAt: text(item, "updatedAt") };
}

export function validateAppData(value: unknown): AppData {
  const root = object(value);
  if (!Array.isArray(root.profiles) || !Array.isArray(root.proxies) || !Array.isArray(root.tasks) || !Array.isArray(root.harvesters)) throw new Error("This is not a Brava configuration backup.");
  const tasks = root.tasks.map(task);
  const parsedProfiles = root.profiles.map(profile);
  const parsedProxies = root.proxies.map(proxy);
  const profileGroups = Array.isArray(root.profileGroups) ? root.profileGroups.map(resourceGroup) : parsedProfiles.length ? [{ id: "profile-group-imported", name: "Imported" }] : [];
  const proxyGroups = Array.isArray(root.proxyGroups) ? root.proxyGroups.map(resourceGroup) : parsedProxies.length ? [{ id: "proxy-group-imported", name: "Imported" }] : [];
  const taskGroups = Array.isArray(root.taskGroups) ? root.taskGroups.map(taskGroup) : tasks.length ? [{ id: "pokemon-center-imported", name: "Pokémon Center", site: "pokemon_center_us" as const }] : [];
  return { profileGroups, proxyGroups, profiles: parsedProfiles.map((item) => ({ ...item, groupId: item.groupId ?? profileGroups[0]?.id })), proxies: parsedProxies.map((item) => ({ ...item, groupId: item.groupId ?? proxyGroups[0]?.id })), taskGroups, tasks: tasks.map((item) => { const loopProfiles = item.loopProfiles ?? item.offerProfileFallback ?? false; return { ...item, groupId: item.groupId ?? taskGroups[0]?.id, waitForQueue: item.waitForQueue ?? false, monitorKeywords: item.monitorKeywords ?? item.name, autoApplyMonitorSignal: item.autoApplyMonitorSignal ?? false, loopProfiles, offerProfileFallback: loopProfiles }; }), harvesters: root.harvesters.map(harvester) };
}
