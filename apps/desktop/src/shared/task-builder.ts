import type { Task } from "./types.js";
import { normalizeCartQuantity } from "./cart-quantity.js";

export type TaskBatchInput = {
  productInput: string;
  profileIds: string[];
  proxyIds: string[];
  batchQuantity: number;
  cartQuantity: number;
  autoApplyMonitorSignal: boolean;
  waitForQueue: boolean;
  loopProfiles: boolean;
};

export function createTaskBatch(input: TaskBatchInput, createId: () => string = () => crypto.randomUUID(), now: () => string = () => new Date().toISOString()): Task[] {
  const productInput = input.productInput.trim();
  if (!productInput) throw new Error("SKU or product URL is required.");
  const batchQuantity = Math.max(1, Math.min(1_000, Math.floor(input.batchQuantity)));
  const cartQuantity = normalizeCartQuantity(input.cartQuantity);
  const profileIds = input.profileIds.length ? [...new Set(input.profileIds)] : [""];
  const proxyIds = [...new Set(input.proxyIds)];
  const isUrl = /^https?:\/\//i.test(productInput);
  const updatedAt = now();

  return profileIds.flatMap((profileId, profileIndex) => Array.from({ length: batchQuantity }, (_, copyIndex) => ({
    id: createId(),
    name: productInput,
    productUrl: isUrl ? productInput : "",
    sku: isUrl ? "" : productInput,
    usePlaceholder: !isUrl && productInput.toUpperCase() === "PLACEHOLDER",
    monitorKeywords: productInput,
    autoApplyMonitorSignal: input.autoApplyMonitorSignal,
    variant: "",
    quantity: cartQuantity,
    effectiveQuantity: cartQuantity,
    profileId,
    proxyId: proxyIds.length ? proxyIds[(profileIndex * batchQuantity + copyIndex) % proxyIds.length]! : "",
    proxyPoolIds: proxyIds,
    waitForQueue: input.waitForQueue,
    queueCheckIntervalMinutes: 3,
    loopProfiles: input.loopProfiles,
    offerProfileFallback: input.loopProfiles,
    status: "idle" as const,
    statusMessage: "Ready to start",
    updatedAt,
    history: [{ status: "idle" as const, message: "Task created", at: updatedAt }],
  })));
}
