export const maximumRequestedCartQuantity = 999;

export function normalizeCartQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 1;
  return Math.max(1, Math.min(maximumRequestedCartQuantity, Math.floor(quantity)));
}

export type CartQuantityResolution = {
  requested: number;
  effective: number;
  maximum?: number;
  clamped: boolean;
};

export function resolveCartQuantity(requestedValue: unknown, maximumValue?: unknown): CartQuantityResolution {
  const requested = normalizeCartQuantity(requestedValue);
  const rawMaximum = Number(maximumValue);
  const maximum = Number.isFinite(rawMaximum) && rawMaximum >= 1
    ? Math.max(1, Math.floor(rawMaximum))
    : undefined;
  const effective = maximum == null ? requested : Math.min(requested, maximum);
  return { requested, effective, maximum, clamped: effective < requested };
}
