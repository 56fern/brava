import { readFile, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStore } from "./store.js";
import type { Task } from "../shared/types.js";

type WebhookKind = "success" | "decline";
type EmbedField = { name: string; value: string; inline?: boolean };

const discordHosts = new Set(["discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com", "canary.discord.com", "ptb.discord.com"]);
const clean = (value: string | number | undefined, fallback = "N/A") => String(value ?? fallback).slice(0, 1024);
export const pokemonCenterOrderStatusUrl = "https://www.pokemoncenter.com/orders";
const markdownLabel = (value: string | number | undefined, fallback = "N/A") => clean(value, fallback).split("").map((character) => "[]()*_`".includes(character) ? `\\${character}` : character).join("");
const brandedWebhooks = new Set<string>();
const appVersion = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch { return "unknown"; }
})();
let avatarDataPromise: Promise<string> | undefined;

function webhookAvatarData(): Promise<string> {
  if (!avatarDataPromise) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const avatarPath = resourcesPath
      ? join(resourcesPath, "app.asar", "build", "webhook-avatar.png")
      : fileURLToPath(new URL("../../build/webhook-avatar.png", import.meta.url));
    avatarDataPromise = new Promise((resolve, reject) => {
      readFile(avatarPath, (error, data) => error ? reject(error) : resolve(`data:image/png;base64,${data.toString("base64")}`));
    });
  }
  return avatarDataPromise;
}

async function ensureWebhookIdentity(url: URL): Promise<void> {
  const key = url.toString();
  if (brandedWebhooks.has(key)) return;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Brava", avatar: await webhookAvatarData() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord rejected the Brava webhook identity (${response.status}).`);
  brandedWebhooks.add(key);
}

export function validateWebhookUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid Discord webhook URL."); }
  if (url.protocol !== "https:" || !discordHosts.has(url.hostname.toLowerCase()) || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) {
    throw new Error("Only official Discord HTTPS webhook URLs are accepted.");
  }
  return url;
}

async function postWebhook(urlValue: string, title: string, color: number, fields: EmbedField[], description?: string): Promise<void> {
  const url = validateWebhookUrl(urlValue);
  await ensureWebhookIdentity(url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Brava",
      allowed_mentions: { parse: [] },
      embeds: [{ title, description, color, fields, timestamp: new Date().toISOString(), footer: { text: `Brava v${appVersion}` } }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord rejected the webhook (${response.status}).`);
}

export async function notifyTask(store: AppStore, task: Task, kind: WebhookKind): Promise<void> {
  const settings = await store.getWebhookSettings();
  const enabled = kind === "success" ? settings.successEnabled : settings.declineEnabled;
  const url = kind === "success" ? settings.successUrl : settings.declineUrl;
  if (!enabled || !url) return;

  const data = await store.load();
  const profile = data.profiles.find((item) => item.id === task.profileId);
  const proxy = data.proxies.find((item) => item.id === task.proxyId);
  const productLabel = task.sku && task.name !== task.sku ? `${task.sku} · ${task.name}` : task.name;
  const productValue = task.productUrl ? `[${clean(productLabel)}](${task.productUrl})` : clean(productLabel);
  const fields: EmbedField[] = [
    { name: "Site", value: "Pokemon Center US", inline: true },
    { name: "Mode", value: "Human checkout", inline: true },
    { name: "Product", value: productValue, inline: true },
    { name: "Size", value: clean(task.variant), inline: true },
    { name: "Price", value: task.checkoutAmount == null ? "N/A" : task.checkoutAmount.toFixed(2), inline: true },
    { name: "Quantity", value: clean(task.effectiveQuantity ?? task.quantity), inline: true },
    { name: "Profile", value: clean(profile?.name), inline: true },
    { name: "Proxy", value: clean(proxy?.name, "Direct"), inline: true },
  ];
  if (kind === "success") {
    const orderNumber = markdownLabel(task.orderNumber);
    fields.push({ name: "Order Number", value: task.orderNumber ? `[${orderNumber}](${pokemonCenterOrderStatusUrl})` : orderNumber, inline: true });
    fields.push({ name: "Shipping ZIP", value: clean(profile?.postalCode), inline: true });
    fields.push({ name: "Email", value: clean(profile?.email), inline: true });
  }
  await postWebhook(url, kind === "success" ? "Checked Out! 🎉" : "Card Declined! ⚠️", kind === "success" ? 0x43d890 : 0xff3366, fields);
}

export async function sendTestWebhook(store: AppStore, kind: WebhookKind): Promise<void> {
  const settings = await store.getWebhookSettings();
  const url = kind === "success" ? settings.successUrl : settings.declineUrl;
  if (!url) throw new Error(`Save a ${kind === "success" ? "checkout" : "decline"} webhook URL first.`);
  await postWebhook(url, "Webhook Test", 0x5978ff, [], "This is a test message from Brava. Your webhook is connected.");
}
