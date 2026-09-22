import { describe, expect, it } from "vitest";
import { isCartedTask } from "../src/shared/task-progress.js";
import type { TaskStatus } from "../src/shared/types.js";

describe("cart counter and filter", () => {
  it("keeps confirmed carts visible through CAPTCHA and submission, then removes terminal tasks", () => {
    for (const status of ["carted", "awaiting_user", "submitting_order"] as TaskStatus[]) {
      expect(isCartedTask({ status, cartedAt: "2026-09-22T12:00:00Z" })).toBe(true);
    }
    for (const status of ["monitoring", "completed", "declined", "stopped", "error"] as TaskStatus[]) {
      expect(isCartedTask({ status, cartedAt: "2026-09-22T12:00:00Z" })).toBe(false);
    }
    expect(isCartedTask({ status: "awaiting_user" })).toBe(false);
    expect(isCartedTask({ status: "adding_to_cart" })).toBe(false);
    expect(isCartedTask({ status: "carted" })).toBe(true);
  });
});
