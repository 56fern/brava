import { readFileSync } from "node:fs";

const discordHosts = new Set([
  "discord.com",
  "www.discord.com",
  "discordapp.com",
  "www.discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

export function validateReleaseWebhookUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("BRAVA_RELEASE_WEBHOOK_URL is not a valid URL."); }
  if (url.protocol !== "https:" || !discordHosts.has(url.hostname.toLowerCase()) || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) {
    throw new Error("BRAVA_RELEASE_WEBHOOK_URL must be an official Discord HTTPS webhook URL.");
  }
  return url;
}

export function buildReleaseWebhookPayload(version, notes, pingEveryone = false) {
  const sections = Array.isArray(notes.sections) ? notes.sections : [];
  const fields = sections
    .filter((section) => section && typeof section.name === "string" && Array.isArray(section.items) && section.items.length > 0)
    .slice(0, 5)
    .map((section) => ({
      name: section.name.slice(0, 256),
      value: section.items.slice(0, 10).map((item) => `• ${String(item)}`).join("\n").slice(0, 1024),
      inline: false,
    }));

  fields.push({
    name: "How to update",
    value: String(notes.instructions ?? "Open Brava, go to Settings, check for updates, then select Update & restart.").slice(0, 1024),
    inline: false,
  });

  return {
    username: "Brava Updates",
    ...(pingEveryone ? { content: "@everyone" } : {}),
    allowed_mentions: { parse: pingEveryone ? ["everyone"] : [] },
    embeds: [{
      author: { name: "Brava Changelog" },
      title: `${notes.title ?? "New Update Available"} (${version})`.slice(0, 256),
      color: 0x1684ec,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: `Brava v${version}` },
    }],
  };
}

export async function sendReleaseWebhook({ url: urlValue, version, notes, avatarPath, pingEveryone = false }) {
  const url = validateReleaseWebhookUrl(urlValue);
  const avatar = `data:image/png;base64,${readFileSync(avatarPath).toString("base64")}`;
  const identityResponse = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Brava Updates", avatar }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!identityResponse.ok) throw new Error(`Discord rejected the Brava release identity (${identityResponse.status}).`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildReleaseWebhookPayload(version, notes, pingEveryone)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Discord rejected the release announcement (${response.status}).`);
}
