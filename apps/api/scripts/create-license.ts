import crypto from "node:crypto";
import { assertProductionSecrets, config } from "../src/config.js";
import { generateLicenseKey, hashLicenseKey } from "../src/crypto.js";
import { closeDatabasePool, getDatabasePool } from "../src/database.js";
import { runBravaMigrations } from "../src/migrations.js";
import { createLicenseStore } from "../src/repository-factory.js";

const label = process.argv[2] ?? "Development license";
const deviceArgument = (process.argv[3] ?? "1").toLowerCase();
const owner = deviceArgument === "owner" || deviceArgument === "unlimited";
const maxDevices = owner ? null : Number(deviceArgument);
if (maxDevices !== null && (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 10)) {
  throw new Error("Device limit must be an integer from 1 to 10, or use 'unlimited' for an owner license.");
}

assertProductionSecrets();
try {
  if (config.licenseStorage === "postgres") await runBravaMigrations(getDatabasePool());
  const repository = createLicenseStore();
  try {
    const key = generateLicenseKey();
    const license = {
      id: crypto.randomUUID(),
      keyHash: hashLicenseKey(key),
      label,
      role: owner ? "owner" as const : "user" as const,
      status: "active" as const,
      maxDevices,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      devices: [],
    };
    await repository.createLicense(license);
    console.log(JSON.stringify({ key, license: { ...license, keyHash: undefined } }, null, 2));
  } finally {
    await repository.close();
  }
} finally {
  if (config.licenseStorage === "postgres") await closeDatabasePool();
}
