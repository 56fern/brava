export type DeviceActivation = {
  deviceId: string;
  deviceName: string;
  activatedAt: string;
  lastSeenAt: string;
};

export type License = {
  id: string;
  keyHash: string;
  label: string;
  role?: "user" | "owner";
  status: "active" | "revoked";
  maxDevices: number | null;
  expiresAt: string | null;
  createdAt: string;
  devices: DeviceActivation[];
};

export type Database = { licenses: License[] };

export type LicenseActivationInput = {
  keyHash: string;
  deviceId: string;
  deviceName: string;
  now: Date;
};

export type LicenseActivationResult =
  | { ok: true; licenseId: string; label: string; expiresAt: string | null }
  | { ok: false; error: "invalid_license" | "expired_license" | "device_limit" };

export type DeviceResetResult = {
  removed: number;
  licenseId: string;
  label: string;
};

export type ProductSignal = {
  sequence: number;
  id: string;
  site: "pokemon_center_us";
  sku: string;
  name: string;
  productUrl: string;
  available: boolean;
  price?: number;
  maxCartQuantity?: number;
  source: string;
  detectedAt: string;
};

export type ProductSignalInput = Omit<ProductSignal, "sequence" | "id" | "detectedAt"> & {
  detectedAt?: string;
};

export type MonitorSourceHealth = {
  source: string;
  status: "warming" | "healthy" | "error";
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  productsSeen: number;
};
