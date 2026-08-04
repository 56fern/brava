import { readFileSync } from "node:fs";
import type { Task } from "../shared/types.js";
import { activeLicenseApiUrl, activeLicenseToken, serverEndpoint } from "./license-client.js";

const appVersion = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch { return "0.0.0"; }
})();

export async function publishPublicCheckout(task: Task): Promise<boolean> {
  const apiUrl = activeLicenseApiUrl();
  const token = activeLicenseToken();
  if (!apiUrl || !token) return false;
  const response = await fetch(serverEndpoint(apiUrl, "v1/checkouts/public"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      eventId: task.id,
      site: "pokemon_center_us",
      sku: task.sku ?? "",
      productName: task.name || task.sku || "Pokemon Center item",
      productUrl: task.productUrl,
      quantity: task.effectiveQuantity ?? task.quantity,
      ...(task.checkoutAmount == null ? {} : { price: task.checkoutAmount }),
      clientVersion: appVersion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}
