import type { Task } from "./types.js";

/** Active carts stay in the cart filter through CAPTCHA and order submission. */
export function isCartedTask(task: Pick<Task, "status" | "cartedAt">): boolean {
  return task.status === "carted" || Boolean(task.cartedAt && ["adding_to_cart", "awaiting_user", "submitting_order"].includes(task.status));
}
