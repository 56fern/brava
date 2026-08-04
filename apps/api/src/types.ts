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
