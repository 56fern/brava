import { config } from "./config.js";
import { getDatabasePool } from "./database.js";
import { PostgresLicenseStore } from "./postgres-license-store.js";
import { LicenseRepository, type LicenseStore } from "./repository.js";

export function createLicenseStore(): LicenseStore {
  return config.licenseStorage === "postgres"
    ? new PostgresLicenseStore(getDatabasePool())
    : new LicenseRepository(config.dataFile);
}
