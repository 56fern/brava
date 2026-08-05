import { config } from "../src/config.js";
import { closeDatabasePool } from "../src/database.js";
import { createLicenseStore } from "../src/repository-factory.js";

const selector = process.argv.slice(2).join(" ").trim();
if (!selector) throw new Error("Enter the exact license label or license ID to reset.");

const repository = createLicenseStore();
const result = await repository.resetDevicesBySelector(selector);

if (!result) throw new Error(`No license matched "${selector}".`);
console.log(`Reset ${result.removed} device activation${result.removed === 1 ? "" : "s"} for ${result.label}.`);
await repository.close();
if (config.licenseStorage === "postgres") await closeDatabasePool();
