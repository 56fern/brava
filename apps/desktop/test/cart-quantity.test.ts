import { describe, expect, it } from "vitest";
import { normalizeCartQuantity, resolveCartQuantity } from "../src/shared/cart-quantity.js";

describe("Pokémon Center cart quantity", () => {
  it("uses the store maximum when the requested quantity is higher", () => {
    expect(resolveCartQuantity(10, 4)).toEqual({ requested: 10, effective: 4, maximum: 4, clamped: true });
  });

  it("keeps the requested quantity when it is within the store maximum", () => {
    expect(resolveCartQuantity(2, 4)).toEqual({ requested: 2, effective: 2, maximum: 4, clamped: false });
  });

  it("normalizes malformed task quantities", () => {
    expect(normalizeCartQuantity(0)).toBe(1);
    expect(normalizeCartQuantity(1_500)).toBe(999);
    expect(resolveCartQuantity(10).effective).toBe(10);
  });
});
