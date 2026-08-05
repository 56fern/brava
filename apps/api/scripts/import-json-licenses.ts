import { config } from "../src/config.js";
import { closeDatabasePool, getDatabasePool } from "../src/database.js";
import { importJsonLicenses } from "../src/import-json-licenses.js";
import { runBravaMigrations } from "../src/migrations.js";

if (config.licenseStorage !== "postgres") {
  throw new Error("Set LICENSE_STORAGE=postgres before importing JSON licenses.");
}
const pool = getDatabasePool();
try {
  await runBravaMigrations(pool);
  const result = await importJsonLicenses(pool, config.dataFile);
  console.log(result.skipped
    ? `Skipped the legacy JSON import because it was already completed (${result.licenses} licenses, ${result.devices} device bindings).`
    : `Imported ${result.licenses} license${result.licenses === 1 ? "" : "s"} and ${result.devices} device binding${result.devices === 1 ? "" : "s"}.`);
} finally {
  await closeDatabasePool();
}
