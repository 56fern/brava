export type QueueGateUpdate = {
  active: boolean;
  position?: number;
  etaSeconds?: number;
};

export type QueueGateOutcome =
  | { status: "passed"; harvesterId: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const queueTextPatterns = [
  /you(?:'|’)re now in line/i,
  /you are now in line/i,
  /virtual waiting room/i,
  /estimated wait time/i,
  /your place in line/i,
  /please wait while we redirect you/i,
];

export function isPokemonCenterQueuePage(urlValue: string, title: string, bodyText: string): boolean {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLowerCase();
    if (host === "queue-it.net" || host.endsWith(".queue-it.net")) return true;
    if (/\bqueue\b/i.test(url.pathname) || /\bqueue\b/i.test(url.search)) return true;
  } catch { /* The text checks below still work while a navigation is starting. */ }
  const searchable = `${title}\n${bodyText}`;
  return queueTextPatterns.some((pattern) => pattern.test(searchable));
}
