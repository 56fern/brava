import { normalizeCartQuantity } from "./cart-quantity";
import { skuFromProductUrl } from "./product-input";
import type { Task } from "./types";

export type TaskEditForm = {
  productInput: string;
  quantity: number;
  profileId: string;
  proxyId: string;
  autoApplyMonitorSignal: boolean;
  waitForQueue: boolean;
  loopProfiles: boolean;
};

export type TaskEditField = keyof TaskEditForm;

export type TaskEditPatch = Partial<Pick<Task,
  | "name"
  | "productUrl"
  | "sku"
  | "usePlaceholder"
  | "monitorKeywords"
  | "autoApplyMonitorSignal"
  | "variant"
  | "quantity"
  | "effectiveQuantity"
  | "maxCartQuantity"
  | "profileId"
  | "proxyId"
  | "proxyPoolIds"
  | "waitForQueue"
  | "loopProfiles"
  | "offerProfileFallback"
>>;

export function taskEditFormFor(task: Task): TaskEditForm {
  return {
    productInput: task.sku?.trim() || skuFromProductUrl(task.productUrl) || task.productUrl || "",
    quantity: task.quantity,
    profileId: task.profileId,
    proxyId: task.proxyId,
    autoApplyMonitorSignal: task.autoApplyMonitorSignal ?? false,
    waitForQueue: task.waitForQueue ?? false,
    loopProfiles: task.loopProfiles ?? task.offerProfileFallback ?? false,
  };
}

export function buildTaskEditPatch(form: TaskEditForm, dirtyFields: Iterable<TaskEditField>): TaskEditPatch {
  const dirty = new Set(dirtyFields);
  const patch: TaskEditPatch = {};

  if (dirty.has("productInput")) {
    const value = form.productInput.trim();
    const isUrl = /^https?:\/\//i.test(value);
    patch.name = value;
    patch.productUrl = isUrl ? value : "";
    patch.sku = isUrl ? skuFromProductUrl(value) : value;
    patch.usePlaceholder = !isUrl && value.toUpperCase() === "PLACEHOLDER";
    patch.monitorKeywords = value;
    patch.variant = "";
  }
  if (dirty.has("quantity")) {
    const quantity = normalizeCartQuantity(form.quantity);
    patch.quantity = quantity;
    patch.effectiveQuantity = quantity;
    patch.maxCartQuantity = undefined;
  }
  if (dirty.has("profileId")) patch.profileId = form.profileId;
  if (dirty.has("proxyId")) {
    patch.proxyId = form.proxyId;
    patch.proxyPoolIds = form.proxyId ? [form.proxyId] : [];
  }
  if (dirty.has("autoApplyMonitorSignal")) patch.autoApplyMonitorSignal = form.autoApplyMonitorSignal;
  if (dirty.has("waitForQueue")) patch.waitForQueue = form.waitForQueue;
  if (dirty.has("loopProfiles")) {
    patch.loopProfiles = form.loopProfiles;
    patch.offerProfileFallback = form.loopProfiles;
  }

  return patch;
}
