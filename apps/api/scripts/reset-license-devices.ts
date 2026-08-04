import { config } from "../src/config.js";
import { LicenseRepository } from "../src/repository.js";

const selector = process.argv.slice(2).join(" ").trim();
if (!selector) throw new Error("Enter the exact license label or license ID to reset.");

const repository = new LicenseRepository(config.dataFile);
const result = await repository.mutate((database) => {
  const license = database.licenses.find((item) => item.id === selector || item.label.toLowerCase() === selector.toLowerCase());
  if (!license) return null;
  const removed = license.devices.length;
  license.devices = [];
  return { label: license.label, removed };
});

if (!result) throw new Error(`No license matched "${selector}".`);
console.log(`Reset ${result.removed} device activation${result.removed === 1 ? "" : "s"} for ${result.label}.`);
